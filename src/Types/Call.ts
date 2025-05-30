export type WACallUpdateType = 'offer' | 'ringing' | 'timeout' | 'reject' | 'accept' | 'terminate'

export type WACallEvent = {
	chatId: string
	from: string
	isGroup?: boolean
	groupJid?: string
	id: string
	date: Date
	isVideo?: boolean
	status: WACallUpdateType
	offline: boolean
	latencyMs?: number
}

export type WACall = {
	id: string
	to: string
	from: string
	creatorJid: string
	devices?: string[]
	isVideo: boolean

}
