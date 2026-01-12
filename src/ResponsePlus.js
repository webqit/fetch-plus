import { messageParserMixin, _meta, _wq } from './messageParserMixin.js';
import { HeadersPlus } from './HeadersPlus.js';

export class ResponsePlus extends messageParserMixin(Response) {

    constructor(body, init = {}) {
        super(body, init);
        HeadersPlus.upgradeInPlace(this.headers);
    }

    static upgradeInPlace(response) {
        if (response instanceof ResponsePlus) return response;
        Object.setPrototypeOf(response, ResponsePlus.prototype);
        HeadersPlus.upgradeInPlace(response.headers);
        return response;
    }

    static from(body, { memoize = false, ...init } = {}) {
        if (body instanceof Response) return body;

        let $type;
        if (typeof body !== 'undefined') {
            let headers;
            ({ body, headers, $type } = super.from({ body, headers: init.headers }));
            init = { ...init, headers };
        }

        const instance = new this(body, init);

        if (memoize) {
            const cache = _meta(instance, 'cache');
            const typeMap = { json: 'json', FormData: 'formData', text: 'text', ArrayBuffer: 'arrayBuffer', Blob: 'blob', Bytes: 'bytes' };
            cache.set(typeMap[$type] || 'original', body);
        }

        return instance;
    }

    get status() {
        return this.headers.has('X-Redirect-Code') ? 200 : super.status;
    }

    clone() {
        const clone = super.clone();
        ResponsePlus.upgradeInPlace(clone);

        const responseMeta = _meta(this);
        _wq(clone).set('meta', new Map(responseMeta));
        if (_meta(clone).has('cache')) {
            _meta(clone).set('cache', new Map(responseMeta.get('cache')));
        }

        return clone;
    }
}


