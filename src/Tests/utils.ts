import { jidEncode } from '../WABinary'


export function randomJid() {
	return jidEncode(Math.floor(Math.random() * 1000000), Math.random() < 0.5 ? 's.whatsapp.net' : 'g.us')
}

export function removeBufferOnString(inputText: string) {
	let replacedText = inputText;

	//URLs starting with http://, https://, or ftp://
	const replacePattern1 = /"type":\s*"Buffer"\s*,\s*"data":\s*(\[[^\]]*\])/gim;


	replacedText = inputText.replace(
		replacePattern1,
		(_, p1) => {
			console.log(p1)
			return `"type": "Buffer", "data": ${JSON.parse(p1).length}`
		},
	);

	return replacedText;
}


function replaceBufferType(obj) {
	for (const key in obj) {
		if (obj[key] && typeof obj[key] === 'object') {
			if (obj[key].type === 'Buffer' && Array.isArray(obj[key].data)) {
				obj[key].data = obj[key].data.length;
			}
			replaceBufferType(obj[key]);
		}
	}

	return obj;
}

export const BufferJSON = {
	replacer: (_key: any, value: any) => {
		if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === 'Buffer') {
			return { type: 'Buffer', data: Buffer.from(value?.data || value).toString('base64') };
		}

		return value;
	},
	reviver: (_key: any, value: any) => {
		if (typeof value === 'object' && !!value && (value.buffer === true || value.type === 'Buffer')) {
			const val = value.data || value.value;
			const buffer =  typeof val === 'string' ? Buffer.from(val, 'base64') : Buffer.from(val || []);
			return { type: 'Buffer', data:buffer.length };
		}

		return value;
	},
};

export function removeBuffer(inputObj: any) {


	// return replaceBufferType(cloneDeep(inputObj))
	if (!inputObj) return null;

	try {
		return JSON.parse(JSON.stringify(inputObj, BufferJSON.replacer, 2), BufferJSON.reviver);
	} catch (e: any) {
		return null;
	}

}