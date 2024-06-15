import { proto } from '../../WAProto'
import { CommunityActionlink, CommunityParticipantAction, GroupMetadata, GroupParticipant, ParticipantAction, SocketConfig, WAMessageKey, WAMessageStubType } from '../Types'
import { generateMessageID, generateMessageIDV2, unixTimestampSeconds } from '../Utils'
import { BinaryNode, getBinaryNodeChild, getBinaryNodeChildren, getBinaryNodeChildString, jidEncode, jidNormalizedUser } from '../WABinary'
import { makeChatsSocket } from './chats'

export const makeGroupsSocket = (config: SocketConfig) => {
	const sock = makeChatsSocket(config)
	const { authState, ev, query, upsertMessage } = sock

	const groupQuery = async(jid: string, type: 'get' | 'set', content: BinaryNode[]) => (
		query({
			tag: 'iq',
			attrs: {
				type,
				xmlns: 'w:g2',
				to: jid,
			},
			content
		})
	)

	const groupMetadata = async(jid: string) => {
		const result = await groupQuery(
			jid,
			'get',
			[ { tag: 'query', attrs: { request: 'interactive' } } ]
		)
		return extractGroupMetadata(result)
	}

	/*
	const groupFetchAllParticipating = async() => {
		const result = await query({
			tag: 'iq',
			attrs: {
				to: '@g.us',
				xmlns: 'w:g2',
				type: 'get',
			},
			content: [
				{
					tag: 'participating',
					attrs: { },
					content: [
						{ tag: 'participants', attrs: { } },
						{ tag: 'description', attrs: { } }
					]
				}
			]
		})
		const data: { [_: string]: GroupMetadata } = { }
		const groupsChild = getBinaryNodeChild(result, 'groups')
		if(groupsChild) {
			const groups = getBinaryNodeChildren(groupsChild, 'group')
			for(const groupNode of groups) {
				const meta = extractGroupMetadata({
					tag: 'result',
					attrs: { },
					content: [groupNode]
				})
				data[meta.id] = meta
			}
		}

		sock.ev.emit('groups.update', Object.values(data))

		return data
	} */

	const groupFetchAllParticipating = async() => {
		const result = await query({
			tag: 'iq',
			attrs: {
				to: '@g.us',
				xmlns: 'w:g2',
				type: 'get',
			},
			content: [
				{
					tag: 'participating',
					attrs: { },
					content: [
						{ tag: 'participants', attrs: { } },
						{ tag: 'description', attrs: { } }
					]
				}
			]
		})
		const data: { [_: string]: GroupMetadata } = { }
		const groupsChild = getBinaryNodeChild(result, 'groups')
		if(groupsChild) {
			const groups = getBinaryNodeChildren(groupsChild, 'group')
			for(const groupNode of groups) {
				const meta = extractGroupMetadata({
					tag: 'result',
					attrs: { },
					content: [groupNode]
				})
				data[meta.id] = meta
			}
		}

		const groups = getBinaryNodeChildren(groupsChild, 'group')

		for(const metadata in data) {
			const group = data[metadata]

			if(group.isCommunity) {
				group.communityGroups = []
				for(const _group of groups) {
					const linkedParent = getBinaryNodeChild(_group, 'linked_parent')
					if(linkedParent && linkedParent.attrs.jid === group.id) {
						const linkedGroupId = _group.attrs.id.includes('@') ? _group.attrs.id : jidEncode(_group.attrs.id, 'g.us')
						group.communityGroups?.push({
							name: _group.attrs.subject,
							jid: linkedGroupId,
							isAnnouncement: !!getBinaryNodeChild(_group, 'default_sub_group'),
						})
					}
				}
			}

			data[metadata] = group
		}

		sock.ev.emit('groups.update', Object.values(data))

		return data
	}

	sock.ws.on('CB:ib,,dirty', async(node: BinaryNode) => {
		const { attrs } = getBinaryNodeChild(node, 'dirty')!
		if(attrs.type !== 'groups') {
			return
		}

		await groupFetchAllParticipating()
		await sock.cleanDirtyBits('groups')
	})

	const communityCreate = async(subject: string, description: string) => {
		const result = await groupQuery('@g.us', 'set', [
			{
				tag: 'create',
				attrs: {
					subject,
				},
				content: [
					{
						tag: 'description',
						attrs: {
							id: generateMessageIDV2(),
						},
						content: [
							{
								tag: 'body',
								attrs: {},
								content: Buffer.from(description, 'utf-8'),
							},
						],
					},
					{
						tag: 'parent',
						attrs: { },
					},
				],
			},
		])

		return extractGroupMetadata(result)

	}

	const communityParticipantsUpdate = async(
		jid: string,
		participants: string[],
		action: CommunityParticipantAction
	) => {
		const result = await groupQuery(
			jid,
			'set',
			[
				{
					tag: 'admin',
					attrs: {},
					content: [
						{
							tag: action,
							attrs: { },
							content: participants.map(jid => ({
								tag: 'participant',
								attrs: { jid }
							}))
						}
					]
				}

			]
		)

		const node = getBinaryNodeChild(result, 'admin')
		const participantsAffected = getBinaryNodeChildren(node, 'participant')
		return participantsAffected.map(p => {
			return { status: p.attrs.error || '200', jid: p.attrs.jid }
		})
	}

	const communityGroupsUpdate = async(jid: string, groupsJid: string[], action: CommunityActionlink) => {

		const nodeAction: BinaryNode[] = []

		if(action == 'link') {
			nodeAction.push({
				tag: 'links',
				attrs: {},
				content: [
					{
						tag: action,
						attrs: {
							link_type: 'sub_group'
						},
						content: groupsJid.map(jid => ({
							tag: 'group',
							attrs: { jid }
						}))
					}
				]
			})
		}

		if(action == 'unlink') {
			nodeAction.push({
				tag: 'unlink',
				attrs: {
					unlink_type: 'sub_group'
				},
				content: groupsJid.map(jid => ({
					tag: 'group',
					attrs: { jid }
				}))
			})
		}

		let result: BinaryNode | undefined = await groupQuery(jid, 'set', nodeAction)

		if(action == 'link') {
			result = getBinaryNodeChild(result, 'links')
		}

		const node = getBinaryNodeChild(result, action)
		const participantsAffected = getBinaryNodeChildren(node, 'group')
		return participantsAffected.map(p => {
			return { status: p.attrs.error || '200', jid: p.attrs.jid }
		})

	}

	const communityDeactivate = async(jid: string) => {
		await groupQuery(
			jid,
			'set',
			[
				{
					tag: 'delete_parent',
					attrs: {}
				}
			]
		)
	}

	return {
		...sock,
		groupMetadata,
		communityDeactivate,
		communityGroupsUpdate,
		communityParticipantsUpdate,
		communityCreate,
		groupCreate: async(subject: string, participants: string[]) => {
			const key = generateMessageIDV2()
			const result = await groupQuery(
				'@g.us',
				'set',
				[
					{
						tag: 'create',
						attrs: {
							subject,
							key
						},
						content: participants.map(jid => ({
							tag: 'participant',
							attrs: { jid }
						}))
					}
				]
			)
			return extractGroupMetadata(result)
		},
		groupLeave: async(id: string) => {
			await groupQuery(
				'@g.us',
				'set',
				[
					{
						tag: 'leave',
						attrs: { },
						content: [
							{ tag: 'group', attrs: { id } }
						]
					}
				]
			)
		},
		groupUpdateSubject: async(jid: string, subject: string) => {
			await groupQuery(
				jid,
				'set',
				[
					{
						tag: 'subject',
						attrs: { },
						content: Buffer.from(subject, 'utf-8')
					}
				]
			)
		},
		groupRequestParticipantsList: async(jid: string) => {
			const result = await groupQuery(
				jid,
				'get',
				[
					{
						tag: 'membership_approval_requests',
						attrs: {}
					}
				]
			)
			const node = getBinaryNodeChild(result, 'membership_approval_requests')
			const participants = getBinaryNodeChildren(node, 'membership_approval_request')
			return participants.map(v => v.attrs)
		},
		groupRequestParticipantsUpdate: async(jid: string, participants: string[], action: 'approve' | 'reject') => {
			const result = await groupQuery(
				jid,
				'set',
				[{
					tag: 'membership_requests_action',
					attrs: {},
					content: 				[
						{
							tag: action,
							attrs: { },
							content: participants.map(jid => ({
								tag: 'participant',
								attrs: { jid }
							}))
						}
					]
				}]
			)
			const node = getBinaryNodeChild(result, 'membership_requests_action')
			const nodeAction = getBinaryNodeChild(node, action)
			const participantsAffected = getBinaryNodeChildren(nodeAction, 'participant')
			return participantsAffected.map(p => {
				return { status: p.attrs.error || '200', jid: p.attrs.jid }
			})
		},
		groupParticipantsUpdate: async(
			jid: string,
			participants: string[],
			action: ParticipantAction
		) => {
			const result = await groupQuery(
				jid,
				'set',
				[
					{
						tag: action,
						attrs: { },
						content: participants.map(jid => ({
							tag: 'participant',
							attrs: { jid }
						}))
					}
				]
			)
			const node = getBinaryNodeChild(result, action)
			const participantsAffected = getBinaryNodeChildren(node, 'participant')
			return participantsAffected.map(p => {
				return { status: p.attrs.error || '200', jid: p.attrs.jid, content: p }
			})
		},
		groupUpdateDescription: async(jid: string, description?: string) => {
			const metadata = await groupMetadata(jid)
			const prev = metadata.descId ?? null

			await groupQuery(
				jid,
				'set',
				[
					{
						tag: 'description',
						attrs: {
							...(description ? { id: generateMessageIDV2() } : { delete: 'true' }),
							...(prev ? { prev } : {})
						},
						content: description ? [
							{ tag: 'body', attrs: {}, content: Buffer.from(description, 'utf-8') }
						] : undefined
					}
				]
			)
		},
		groupInviteCode: async(jid: string) => {
			const result = await groupQuery(jid, 'get', [{ tag: 'invite', attrs: {} }])
			const inviteNode = getBinaryNodeChild(result, 'invite')
			return inviteNode?.attrs.code
		},
		groupRevokeInvite: async(jid: string) => {
			const result = await groupQuery(jid, 'set', [{ tag: 'invite', attrs: {} }])
			const inviteNode = getBinaryNodeChild(result, 'invite')
			return inviteNode?.attrs.code
		},
		groupAcceptInvite: async(code: string) => {
			const results = await groupQuery('@g.us', 'set', [{ tag: 'invite', attrs: { code } }])
			const result = getBinaryNodeChild(results, 'group')
			return result?.attrs.jid
		},
		/**
		 * accept a GroupInviteMessage
		 * @param key the key of the invite message, or optionally only provide the jid of the person who sent the invite
		 * @param inviteMessage the message to accept
		 */
		groupAcceptInviteV4: ev.createBufferedFunction(async(key: string | WAMessageKey, inviteMessage: proto.Message.IGroupInviteMessage) => {
			key = typeof key === 'string' ? { remoteJid: key } : key
			const results = await groupQuery(inviteMessage.groupJid!, 'set', [{
				tag: 'accept',
				attrs: {
					code: inviteMessage.inviteCode!,
					expiration: inviteMessage.inviteExpiration!.toString(),
					admin: key.remoteJid!
				}
			}])

			// if we have the full message key
			// update the invite message to be expired
			if(key.id) {
				// create new invite message that is expired
				inviteMessage = proto.Message.GroupInviteMessage.fromObject(inviteMessage)
				inviteMessage.inviteExpiration = 0
				inviteMessage.inviteCode = ''
				ev.emit('messages.update', [
					{
						key,
						update: {
							message: {
								groupInviteMessage: inviteMessage
							}
						}
					}
				])
			}

			// generate the group add message
			await upsertMessage(
				{
					key: {
						remoteJid: inviteMessage.groupJid,
						id: generateMessageIDV2(sock.user?.id),
						fromMe: false,
						participant: key.remoteJid,
					},
					messageStubType: WAMessageStubType.GROUP_PARTICIPANT_ADD,
					messageStubParameters: [
						authState.creds.me!.id
					],
					participant: key.remoteJid,
					messageTimestamp: unixTimestampSeconds()
				},
				'notify'
			)

			return results.attrs.from
		}),
		groupGetInviteInfo: async(code: string) => {
			const results = await groupQuery('@g.us', 'get', [{ tag: 'invite', attrs: { code } }])
			return extractGroupMetadata(results)
		},
		groupToggleEphemeral: async(jid: string, ephemeralExpiration: number) => {
			const content: BinaryNode = ephemeralExpiration ?
				{ tag: 'ephemeral', attrs: { expiration: ephemeralExpiration.toString() } } :
				{ tag: 'not_ephemeral', attrs: { } }
			await groupQuery(jid, 'set', [content])
		},
		groupSettingUpdate: async(jid: string, setting: 'announcement' | 'not_announcement' | 'locked' | 'unlocked') => {
			await groupQuery(jid, 'set', [ { tag: setting, attrs: { } } ])
		},
		groupMemberAddMode: async(jid: string, mode: 'admin_add' | 'all_member_add') => {
			await groupQuery(jid, 'set', [ { tag: 'member_add_mode', attrs: { }, content: mode } ])
		},
		groupJoinApprovalMode: async(jid: string, mode: 'on' | 'off') => {
			await groupQuery(jid, 'set', [ { tag: 'membership_approval_mode', attrs: { }, content: [ { tag: 'group_join', attrs: { state: mode } } ] } ])
		},
		groupFetchAllParticipating
	}
}


export const extractGroupMetadata = (result: BinaryNode) => {
	const group = getBinaryNodeChild(result, 'group')!
	const descChild = getBinaryNodeChild(group, 'description')
	const communityNode = getBinaryNodeChild(group, 'linked_parent')
	const communityNodeSettings = getBinaryNodeChild(group, 'parent')

	let desc: string | undefined
	let descId: string | undefined
	let descTime: number | undefined
	let descOwner: string | undefined
	if(descChild) {
		desc = getBinaryNodeChildString(descChild, 'body')
		descId = descChild.attrs.id
		descTime = +descChild.attrs.t
		descOwner = descChild.attrs.participant
	}

	let communityId: string | undefined
	if(communityNode) {
		communityId = communityNode.attrs.jid
	}

	const groupId = group.attrs.id.includes('@') ? group.attrs.id : jidEncode(group.attrs.id, 'g.us')
	const eph = getBinaryNodeChild(group, 'ephemeral')?.attrs.expiration
	const communityParent = getBinaryNodeChild(group, 'linked_parent')
	let communityParentJid: any

	if(typeof communityParent === 'object' && communityParent !== null && 'attrs' in communityParent && typeof communityParent.attrs === 'object' && 'jid' in communityParent.attrs) {
		communityParentJid = communityParent.attrs.jid
	}

	const memberAddMode = getBinaryNodeChildString(group, 'member_add_mode') == 'all_member_add'
	const metadata: GroupMetadata = {
		id: groupId,
		subject: group.attrs.subject,
		subjectOwner: group.attrs.s_o,
		subjectTime: +group.attrs.s_t,
		size: getBinaryNodeChildren(group, 'participant').length,
		creation: +group.attrs.creation,
		owner: group.attrs.creator ? jidNormalizedUser(group.attrs.creator) : undefined,
		desc,
		descId,
		descTime,
		descOwner,
		communityId,
		community: !!communityNodeSettings,
		communityDefaultGroup: !!getBinaryNodeChild(group, 'default_sub_group'),
		linkedParent: getBinaryNodeChild(group, 'linked_parent')?.attrs.jid || undefined,
		restrict: !!getBinaryNodeChild(group, 'locked'),
		announce: !!getBinaryNodeChild(group, 'announcement'),
		isCommunity: !!getBinaryNodeChild(group, 'parent'),
		communityParent: communityParentJid,
		isCommunityAnnounce: !!getBinaryNodeChild(group, 'default_sub_group'),
		joinApprovalMode: !!getBinaryNodeChild(group, 'membership_approval_mode'),
		memberAddMode,
		participants: getBinaryNodeChildren(group, 'participant').map(
			({ attrs }) => {
				return {
					id: attrs.jid,
					admin: (attrs.type || null) as GroupParticipant['admin'],
				}
			}
		),
		ephemeralDuration: eph ? +eph : undefined
	}
	return metadata
}
