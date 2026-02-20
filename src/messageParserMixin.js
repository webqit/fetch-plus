import { _isString, _isObject, _isTypeObject, _isNumber, _isBoolean, _isPlainObject, _isPlainArray } from '@webqit/util/js/index.js';
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

            if (isAsyncIterable(body) || isGenerator(body)) {
                body = asyncIterableToStream(body);
                const type = 'ReadableStream';
                headers['content-type'] ??= 'application/octet-stream';
                return { body, headers: new Headers(headers), $type: type };
            }

            let type = [null, undefined].includes(body) ? null : dataType(body);

            // Binary bodies
            if (['Blob', 'File'].includes(type)) {

                headers['content-type'] ??= body.type;
                headers['content-length'] ??= body.size;

            } else if (['Uint8Array', 'Uint16Array', 'Uint32Array', 'ArrayBuffer'].includes(type)) {
                headers['content-length'] ??= body.byteLength;
            }

            // JSON objects
            else if (type === 'json' && _isTypeObject(body)) {
                const { result: _body, isDirectlySerializable } = FormDataPlus.json(body, { encodeLiterals: true, meta: true });
                if (isDirectlySerializable) {

                    body = JSON.stringify(body, (k, v) => v instanceof Error ? { ...v, message: v.message } : v);
                    headers['content-type'] = 'application/json';
                    headers['content-length'] = (new Blob([body])).size;

                } else {
                    body = _body;
                    type = 'FormData';
                }
            }

            // Strings
            else if (['text', 'json'].includes(type) && !headers['content-length']) {
                headers['content-length'] = (new Blob([body])).size;
            }

            if (!['FormData', null].includes(type)
                && !['function'].includes(typeof body)
                && !headers['content-type']) {
                headers['content-type'] = 'application/octet-stream';
            }

            // Return canonical init object with type info
            return { body, headers: new Headers(headers), $type: type };
        }

        async formData() {
            const fd = await super.formData();
            FormDataPlus.upgradeInPlace(fd);
            return fd;
        }

        async any({ to = null, memo = false } = {}) {
            if (to && ![
                'blob', 'text', 'json', 'arrayBuffer', 'bytes', 'formData'
            ].includes(to)) throw new Error(`Invalid target type specified: ${to}`);

            if (this.body === null) return null;

            const cache = _meta(this, 'cache');
            const readAs = async (type) => {
                // 1. Direct parsing
                if (!memo) return await this[type || 'bytes']();

                const byValue = (x) => {
                    if (x instanceof FormData) {
                        const clone = new FormDataPlus;
                        for (const [k, v] of x.entries()) clone.append(k, v);
                        return clone;
                    }
                    if ((!type || type === 'json')
                        && (_isPlainObject(x) || _isPlainArray(x))) {
                        return structuredClone(x);
                    }
                    return x;
                };

                // 2. Direct original
                if (!type && cache.has('original')) return byValue(cache.has('original'));

                // Default type
                type ??= 'bytes';

                // 3. Direct cache matching
                if (cache.has(type)) return byValue(cache.get(type));

                // 4. Clone + parse
                let result;
                if (cache.has('memo')) {
                    result = cache.get('memo').clone()[type]();
                } else {
                    cache.set('memo', this.clone());
                    result = await this[type]();
                }

                cache.set(type, result);

                return byValue(result);
            };

            const contentType = (this.headers.get('Content-Type') || '').split(';')[0].trim();
            let result;
            if ((!to || ['formData', 'json'].includes(to))
                && ['multipart/form-data', 'application/x-www-form-urlencoded'].includes(contentType)) {
                let fd = await readAs('formData');
                FormDataPlus.upgradeInPlace(fd);

                if (to === 'json') {
                    fd = await fd.json({ decodeLiterals: true });
                }

                result = fd;
            } else if ((!to || ['formData', 'json'].includes(to))
                && contentType === 'application/json') {
                let json = await readAs('json');

                if (to === 'formData') {
                    json = FormDataPlus.json(json, { encodeLiterals: true });
                }

                result = json;
            } else if (!to && (
                contentType.startsWith('image/') ||
                contentType.startsWith('video/') ||
                contentType.startsWith('audio/') ||
                (contentType.startsWith('application/')
                    && !['xml', 'json', 'javascript', 'x-www-form-urlencoded'].some(t => contentType.includes(t)))
            )) {
                result = await readAs('blob');
            } else if (!to && (
                contentType.startsWith('text/') ||
                (contentType.startsWith('application/')
                    && ['xml', 'javascript'].some((t) => contentType.includes(t))
                ))) {
                result = await readAs('text');
            } else {
                if (['json', 'formData'].includes(to)) {
                    throw new Error(`Cannot convert body of type ${contentType} to ${to}`);
                }
                result = await readAs(to);
            }

            return result;
        }

        forget() {
            const cache = _meta(this, 'cache');
            cache.clear();
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
    if (_isString(value)) {
        return 'text';
    }

    if (_isTypeObject(value)) {
        const toStringTag = value[Symbol.toStringTag];
        const type = [
            'Uint8Array', 'Uint16Array', 'Uint32Array', 'ArrayBuffer', 'Blob', 'File', 'FormData', 'Stream', 'ReadableStream'
        ].reduce((_toStringTag, type) => _toStringTag || (toStringTag === type ? type : null), null);

        if (type) return type;

        if (_isObject(value) || Array.isArray(value)) {
            return 'json';
        }

        if ('toString' in value) return 'text';
    }

    return null;
}

// --------------

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

// --------------

export const isGenerator = (obj) => {
    return typeof obj?.next === 'function'
        //&& typeof obj?.throw === 'function'
        //&& typeof obj?.return === 'function';
};

export function isAsyncIterable(obj) {
    return (
        obj !== null &&
        typeof obj === 'object' &&
        typeof obj[Symbol.asyncIterator] === 'function'
    );
}

export function asyncIterableToStream(iterable) {
    if (!isAsyncIterable(iterable) && !isGenerator(body)) {
        throw new TypeError('Body must be an async iterable.');
    }

    const iterator = isGenerator(iterable) ? iterable : iterable[Symbol.asyncIterator]();
    const encoder = new TextEncoder();
    let finished = false;

    const closeIterator = async (reason) => {
        if (finished) return;
        finished = true;

        if (typeof iterator.return === 'function') {
            try {
                await iterator.return(reason);
            } catch { }
        }
    };

    const encodeChunk = (value) => {
        if (value == null) return null;

        // Binary passthrough
        if (value instanceof Uint8Array) {
            return value;
        }

        // Text passthrough
        if (typeof value === 'string') {
            return encoder.encode(value);
        }

        // JSON (objects, arrays, numbers, booleans)
        if (
            typeof value === 'object' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
        ) {
            return encoder.encode(JSON.stringify(value) + '\n');
        }

        throw new TypeError(
            `Unsupported chunk type in async iterable: ${typeof value}`
        );
    };

    return new ReadableStream({
        async pull(controller) {
            try {
                const { value, done } = await iterator.next();

                if (done) {
                    await closeIterator();
                    controller.close();
                    return;
                }

                const chunk = encodeChunk(value);
                if (chunk) controller.enqueue(chunk);

            } catch (err) {
                await closeIterator();
                controller.error(err);
            }
        },

        async cancel(reason) {
            await closeIterator(reason);
        }
    });
}

function streamToAsyncIterable(stream, { parse = null } = {}) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();

    let finished = false;
    let buffer = '';

    const close = async () => {
        if (finished) return;
        finished = true;
        try {
            await reader.cancel();
        } catch { }
        reader.releaseLock();
    };

    return {
        async *[Symbol.asyncIterator]() {
            try {
                while (true) {
                    const { value, done } = await reader.read();
                    if (done) break;

                    if (parse === 'ndjson') {
                        buffer += decoder.decode(value, { stream: true });

                        let lines = buffer.split('\n');
                        buffer = lines.pop(); // incomplete fragment

                        for (const line of lines) {
                            if (line.trim()) yield JSON.parse(line);
                        }

                        continue;
                    }

                    yield value;
                }

                if (parse === 'ndjson' && buffer.trim()) {
                    yield JSON.parse(buffer);
                }

            } finally {
                await close();
            }
        }
    };
}
