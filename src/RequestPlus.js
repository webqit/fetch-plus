import { messageParserMixin, _meta, _wq } from './messageParserMixin.js';
import { HeadersPlus } from './HeadersPlus.js';

export class RequestPlus extends messageParserMixin(Request) {

    constructor(url, init = {}) {
        super(url, init);
        HeadersPlus.upgradeInPlace(this.headers);
    }

    static upgradeInPlace(request) {
        if (request instanceof RequestPlus) return request;
        Object.setPrototypeOf(request, RequestPlus.prototype);
        HeadersPlus.upgradeInPlace(request.headers);
        return request;
    }

    static from(url, { memoize = false, ...init } = {}) {
        if (url instanceof Request) return url;

        let $type, $$body = init.body;
        if ('body' in init) {
            const { body, headers, $type: $$type } = super.from(init);
            init = { ...init, body, headers };
            $type = $$type;
        }

        const instance = new this(url, init);

        if (memoize) {
            const cache = _meta(instance, 'cache');
            const typeMap = { json: 'json', FormData: 'formData', text: 'text', ArrayBuffer: 'arrayBuffer', Blob: 'blob', Bytes: 'bytes' };
            cache.set(typeMap[$type] || 'original', $$body);
        }

        return instance;
    }

    static async copy(request, init = {}) {
        const attrs = ['method', 'headers', 'mode', 'credentials', 'cache', 'redirect', 'referrer', 'integrity'];
        const requestInit = attrs.reduce(($init, prop) => (
            {
                ...$init,
                [prop]: prop in init
                    ? init[prop]
                    : (prop === 'headers'
                        ? new Headers(request[prop])
                        : request[prop])
            }
        ), {});
        if (!['GET', 'HEAD'].includes(requestInit.method.toUpperCase())) {
            if ('body' in init) {
                requestInit.body = init.body
                if (!('headers' in init)) {
                    requestInit.headers.delete('Content-Type');
                    requestInit.headers.delete('Content-Length');
                }
            } else {
                requestInit.body = await request.clone().arrayBuffer();
            }
        } else {
            requestInit.body = null;
        }
        if (requestInit.mode === 'navigate') {
            requestInit.mode = 'cors';
        }
        return { url: init.url || request.url, ...requestInit };
    }

    clone() {
        const clone = super.clone();
        RequestPlus.upgradeInPlace(clone);

        const requestMeta = _meta(this);
        _wq(clone).set('meta', new Map(requestMeta));
        if (_meta(clone).has('cache')) {
            _meta(clone).set('cache', new Map(requestMeta.get('cache')));
        }

        return clone;
    }
}


