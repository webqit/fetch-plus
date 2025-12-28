import { _isString, _isObject, _isTypeObject, _isNumber, _isBoolean } from '@webqit/util/js/index.js';
import { _wq as $wq } from '@webqit/util/js/index.js';
import { FormDataPlus } from './FormDataPlus.js';

export const _wq = (target, ...args) => $wq(target, 'fetch+', ...args);
export const _meta = (target, ...args) => $wq(target, 'fetch+', 'meta', ...args);

export function messageParserMixin(superClass) {
    return class extends superClass {

        static from(httpMessageInit) {
            const headers = (httpMessageInit.headers instanceof Headers)

                ? [...httpMessageInit.headers.entries()].reduce((_headers, [name, value]) => {
                    const key = name.toLowerCase();
                    _headers[key] = _headers[key] ? [].concat(_headers[key], value) : value;
                    return _headers;
                }, {})

                : Object.keys(httpMessageInit.headers || {}).reduce((_headers, name) => {
                    _headers[name.toLowerCase()] = httpMessageInit.headers[name];
                    return _headers;
                }, {});

            // Process body
            let body = httpMessageInit.body;
            let type = dataType(body);

            // Binary bodies
            if (['Blob', 'File'].includes(type)) {

                headers['content-type'] ??= body.type;
                headers['content-length'] ??= body.size;

            } else if (['Uint8Array', 'Uint16Array', 'Uint32Array', 'ArrayBuffer'].includes(type)) {
                headers['content-length'] ??= body.byteLength;
            }

            // JSON objects
            else if (type === 'json' && _isTypeObject(body)) {
                const [_body, isJsonfiable] = FormDataPlus.json(body, { recursive: true, getIsJsonfiable: true });
                if (isJsonfiable) {

                    body = JSON.stringify(body, (k, v) => v instanceof Error ? { ...v, message: v.message } : v);
                    headers['content-type'] = 'application/json';
                    headers['content-length'] = (new Blob([body])).size;

                } else {
                    body = _body;
                    type = 'FormData';
                }
            }

            // JSON strings
            else if (type === 'json' && !headers['content-length']) {
                headers['content-length'] = (body + '').length;
            }

            // Return canonical init object with type info
            return { body, headers, $type: type };
        }

        async parse({ to = null, memoize = false } = {}) {
            const cache = _meta(this, 'cache');
            const toOther = ['text', 'arrayBuffer', 'blob', 'bytes'].includes(to);

            const contentType = (this.headers.get('Content-Type') || '').split(';')[0].trim();
            let result;

            const throw_cantConvert = () => {
                throw new Error(`Can't convert response of type ${contentType} to: ${to}`);
            };

            if (!toOther
                && ['multipart/form-data', 'application/x-www-form-urlencoded'].includes(contentType)) {
                if (to && !['formData', 'json'].includes(to)) throw_cantConvert();

                if (memoize && cache.has(to || 'formData')) {
                    return cache.get(to || 'formData');
                }

                let fd = await this.formData();
                if (fd) {
                    fd = FormDataPlus.upgradeInPlace(fd);
                    if (memoize) cache.set('formData', fd);

                    if (to === 'json') {
                        fd = await fd.json({ recursive: true });
                        if (memoize) cache.set('json', { ...fd });
                    }
                }

                result = fd;
            } else if (!toOther
                && contentType === 'application/json') {
                if (to && !['json', 'formData'].includes(to)) throw_cantConvert();

                if (memoize && cache.has(to || 'json')) {
                    return cache.get(to || 'json');
                }

                let json = await this.json();
                if (json) {
                    if (memoize) cache.set('json', { ...json });

                    if (to === 'formData') {
                        json = FormDataPlus.json(json, { recursive: true });
                        if (memoize) cache.set('formData', json);
                    }
                }

                result = json;
            } else /*if (contentType === 'text/plain')*/ {
                if (to && !toOther) throw_cantConvert();

                if (memoize) {
                    const result = cache.get(to || 'text') || cache.get('original');
                    if (result) return result;
                }

                result = await this[to || 'text']();

                if (memoize) cache.set(to || 'text', result);
            }

            return result;
        }
    };
}

// ------ Util

export function dataType(value) {
    if (value instanceof FormData) {
        return 'FormData';
    }
    if (value === null || _isNumber(value) || _isBoolean(value)) {
        return 'json';
    }
    if (_isString(value)
        || _isTypeObject(value) && 'toString' in value) {
        return 'text';
    }
    if (!_isTypeObject(value)) return null;

    const toStringTag = value[Symbol.toStringTag];
    const type = [
        'Uint8Array', 'Uint16Array', 'Uint32Array', 'ArrayBuffer', 'Blob', 'File', 'FormData', 'Stream', 'ReadableStream'
    ].reduce((_toStringTag, type) => _toStringTag || (toStringTag === type ? type : null), null);

    if (type) return type;

    if ((_isObject(value)) || Array.isArray(value)) {
        return 'json';
    }
    return null;
}

export function isTypeReadable(obj) {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj.read === 'function' && // streams have .read()
        typeof obj.pipe === 'function' && // streams have .pipe()
        typeof obj.on === 'function'      // streams have event listeners
    );
}

export function isTypeStream(obj) {
    return obj instanceof ReadableStream
        || isTypeReadable(obj);
}
