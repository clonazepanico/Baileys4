import { DEFAULT_CONNECTION_CONFIG } from '../Defaults/index.js'
import type { UserFacingSocketConfig } from '../Types/index.js'
import { makeCommunitiesSocket } from './communities.js'

// export the last socket layer
const makeWASocket = (config: UserFacingSocketConfig) => {
	const newConfig = {
		...DEFAULT_CONNECTION_CONFIG,
		...config
	}

	return makeCommunitiesSocket(newConfig)
}

export default makeWASocket
