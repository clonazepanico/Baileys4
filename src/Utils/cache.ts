import { Logger } from 'pino'
import { SocketConfig } from '../Types'


interface WaCacheData<T=any>{
    timeout: Date;
    data: T;
};


type WaCacheMap<T=any> = {[key: string]: WaCacheData<T>};


export default class WaCache<T = any> {

	private _cacheData: WaCacheMap<T> = {}
	private _timer: NodeJS.Timeout
	private _timeoutMs: number
	private _logger?: Logger

	constructor(timeoutMs: number, config?: SocketConfig) {
    	this._timeoutMs = timeoutMs
    	this._timer = setInterval(this._cleanCache.bind(this), 2_000)
    	this._logger = config?.logger
	}

	private _cacheIsExpired(c: WaCacheData<T>): boolean {
    	const now = new Date()
    	return now > c.timeout
	}

	private _cleanCache() {
    	const removeKeys: string[] = []

    	for(const [key, cache] of Object.entries(this._cacheData)) {
    		if(this._cacheIsExpired(cache)) {
    			this._logger?.debug({ cache }, 'cache expired, removing')
    			removeKeys.push(key)
    		}
    	}

    	for(let index = 0; index < removeKeys.length; index++) {
    		const key = removeKeys[index]
    		delete this._cacheData[key]
    	}
	}


	getCache(key: string): T | undefined {
    	const cache = this._cacheData[key]

    	if(!cache || this._cacheIsExpired(cache)) {
    		return
    	}

    	return cache.data
	}

	putCache(key: string, data: T) {
    	const now = new Date()
    	const timeout = new Date(now.getTime() + this._timeoutMs)

    	this._cacheData[key] = { data, timeout }
	}

	removeCache(key: string) {
    	const cache = this.getCache(key)

    	if(cache) {
    		this._logger?.debug({ cache }, 'removing cache.')
    		delete this._cacheData[key]
    	}
	}

	stop() {
    	clearInterval(this._timer)
	}

}
