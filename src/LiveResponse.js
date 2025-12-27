import { _isObject, _isTypeObject } from '@webqit/util/js/index.js';
import { BroadcastChannelPlus, WebSocketPlus, MessagePortPlus, Observer } from '@webqit/port-plus';
import { isTypeStream, _meta, _wq } from './core.js';
import { ResponsePlus } from './ResponsePlus.js';
import { HeadersPlus } from './HeadersPlus.js';

export class LiveResponse extends EventTarget {

    static get xHeaderName() {
        return 'X-Background-Messaging-Port';
    }

    static test(unknown) {
        if (unknown instanceof LiveResponse
            || unknown?.[Symbol.toStringTag] === 'LiveResponse') {
            return 'LiveResponse';
        }
        if (unknown?.[Symbol.toStringTag] === 'LiveProgramHandle') {
            return 'LiveProgramHandle';
        }
        if (unknown instanceof Response) {
            return 'Response';
        }
        if (isGenerator(unknown)) {
            return 'Generator';
        }
        return 'Default';
    }

    static hasBackgroundPort(respone) {
        return !!respone.headers?.get?.(this.xHeaderName)?.trim();
    }

    static getBackgroundPort(respone) {
        if (!/Response/.test(this.test(respone))) {
            return;
        }
        const responseMeta = _meta(respone);

        if (!responseMeta.has('background_port')) {
            const value = respone.headers.get(this.xHeaderName)?.trim();
            if (!value) return;

            const [proto, portID] = value.split(':');
            if (!['ws', 'br'].includes(proto)) {
                throw new Error(`Unknown background messaging protocol: ${value}`);
            }

            const backgroundPort = proto === 'br'
                ? new BroadcastChannelPlus(portID)
                : new WebSocketPlus(portID);

            responseMeta.set('background_port', backgroundPort);
        }

        return responseMeta.get('background_port');
    }

    static from(data, ...args) {
        return new this(data, ...args);
    }

    /* INSTANCE */

    [Symbol.toStringTag] = 'LiveResponse';

    constructor(body, ...args) {
        super();
        this.#replaceWith(body, ...args);
    }

    /* Level 1 props */

    #body = null;
    get body() { return this.#body; }

    get bodyUsed() { return false; }

    #headers = new HeadersPlus;
    get headers() { return this.#headers; }

    #status = 200;
    get status() { return this.#status; }

    #statusText = '';
    get statusText() { return this.#statusText; }

    /* Level 2 props */

    #type = 'basic';
    get type() { return this.#type; }

    #redirected = false;
    get redirected() { return this.#redirected; }

    #url = null;
    get url() { return this.#url; }

    get ok() { return this.#status >= 200 && this.#status < 299; }

    async arrayBuffer() { throw new Error(`LiveResponse does not support the arrayBuffer() method.`); }

    async formData() { throw new Error(`LiveResponse does not support the formData() method.`); }

    async json() { throw new Error(`LiveResponse does not support the json() method.`); }

    async text() { throw new Error(`LiveResponse does not support the text() method.`); }

    async blob() { throw new Error(`LiveResponse does not support the blob() method.`); }

    async bytes() { throw new Error(`LiveResponse does not support the bytes() method.`); }

    /* Level 3 props */

    get background() { return this.constructor.getBackgroundPort(this); }

    // Lifecycle

    #abortController = new AbortController;
    get signal() { return this.#abortController.signal; }

    get readyState() {
        const readyStateInternals = getReadyStateInternals.call(this);
        return readyStateInternals.done.state ? 'done'
            : (readyStateInternals.live.state ? 'live' : 'waiting');
    }

    readyStateChange(query) {
        if (!['live', 'done'].includes(query)) {
            throw new Error(`Invalid readyState query "${query}"`);
        }
        const readyStateInternals = getReadyStateInternals.call(this);
        return readyStateInternals[query].promise;
    }

    disconnect() {
        this.#abortController.abort();
        this.#abortController = new AbortController;
    }

    #currentFramePromise;
    #extendLifecycle(promise) {
        const readyStateInternals = getReadyStateInternals.call(this);
        if (readyStateInternals.done.state) {
            throw new Error('Response already done.');
        }
        this.#currentFramePromise = promise;
        promise.then((value) => {
            if (this.#currentFramePromise === promise) {
                this.#currentFramePromise = null;
                readyStateInternals.done.state = true;
                readyStateInternals.done.resolve(value);
            }
        }).catch((e) => {
            if (this.#currentFramePromise === promise) {
                this.#currentFramePromise = null;
                readyStateInternals.done.state = true;
                readyStateInternals.done.reject(e);
            }
        });
    }

    async replaceWith(body, ...args) {
        if (this.readyState === 'done') {
            throw new Error('Response already done.');
        }
        this.disconnect(); // Disconnect from existing source if any
        await this.#replaceWith(body, ...args);
    }

    async #replaceWith(body, ...args) {
        if (body instanceof Promise) {
            this.#extendLifecycle(body);
            return await new Promise((resolve, reject) => {
                let aborted = false;
                this.#abortController.signal.addEventListener('abort', () => {
                    aborted = true
                    resolve();
                });
                body.then(async (resolveData) => {
                    if (aborted) return;
                    await this.#replaceWith(resolveData, ...args);
                    resolve();
                });
                body.catch((e) => reject(e));
            });
        }

        // ----------- Formatters

        const directReplaceWith = (responseLike) => {
            const $body = responseLike.body;

            this.#status = responseLike.status;
            this.#statusText = responseLike.statusText;

            for (const [name] of [/*IMPORTANT*/...this.#headers.entries()]) { // for some reason, some entries not produced when not spread
                this.#headers.delete(name);
            }
            for (const [name, value] of responseLike.headers.entries()) {
                this.#headers.append(name, value);
            }

            this.#type = responseLike.type;
            this.#redirected = responseLike.redirected;
            this.#url = responseLike.url;

            this.#body = $body;

            // Must come after all property assignments above because it fires events
            Observer.defineProperty(this, 'body', { get: () => this.#body, enumerable: true, configurable: true });

            const readyStateInternals = getReadyStateInternals.call(this);
            readyStateInternals.live.state = true;
            readyStateInternals.live.resolve();

            this.dispatchEvent(new Event('replace'));
        };

        const wrapReplaceWith = async (body, options) => {
            directReplaceWith({
                body,
                status: 200,
                statusText: '',
                headers: new Headers,
                ...options,
                type: 'basic',
                redirected: false,
                url: null
            });
        };

        // ----------- "Response" handler

        const execReplaceWithResponse = async (response, options) => {
            let body, jsonSuccess = false;
            try {
                body = response instanceof Response
                    ? await ResponsePlus.prototype.parse.call(response, { to: 'json' })
                    : response.body;
                jsonSuccess = true;
            } catch (e) {
                body = response.body;
            }
            directReplaceWith({
                body,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                ...options,
                type: response.type,
                redirected: response.redirected,
                url: response.url,
            });

            if (this.constructor.test(response) === 'LiveResponse') {
                response.addEventListener('replace', () => {
                    directReplaceWith(response)
                }, { signal: this.#abortController.signal });
                return await response.readyStateChange('done');
            }

            if (this.hasBackgroundPort(response)) {
                const backgroundPort = this.constructor.getBackgroundPort(response);
                // Bind to upstream mutations
                let undoInitialProjectMutations;
                if (jsonSuccess) {
                    undoInitialProjectMutations = donePromise.projectMutations({
                        from: 'initial_response',
                        to: body,
                        signal: this.#abortController.signal
                    });
                }
                // Bind to replacements
                backgroundPort.addEventListener('response.replace', (e) => {
                    undoInitialProjectMutations?.();
                    undoInitialProjectMutations = null;

                    directReplaceWith(e.data);
                }, { signal: this.#abortController.signal });
                // Wait until done
                return await backgroundPort.readyStateChange('close');
            }

            return Promise.resolve();
        };

        // ----------- "Generator" handler

        const execReplaceWithGenerator = async (gen, options) => {
            const firstFrame = await gen.next();
            const firstValue = await firstFrame.value;

            await this.#replaceWith(firstValue, { done: firstFrame.done, ...options });
            // this is the first time options has a chance to be applied

            let frame = firstFrame;
            let value = firstValue;

            while (!frame.done && !this.#abortController.signal.aborted) {
                frame = await gen.next();
                value = await frame.value;
                if (!this.#abortController.signal.aborted) {
                    await this.#replaceWith(value, { done: options.done === false ? false : frame.done });
                    // top-level false need to be respected: means keep instance alive even when done
                }
            }
        };

        // ----------- "LiveProgramHandle" handler

        const execReplaceWithLiveProgramHandle = async (liveProgramHandle, options) => {
            await this.#replaceWith(liveProgramHandle.value, options);
            // this is the first time options has a chance to be applied

            Observer.observe(
                liveProgramHandle,
                'value',
                (e) => this.#replaceWith(e.value, { done: false }),
                // we're never done unless explicitly aborted
                { signal: this.#abortController.signal }
            );

            return new Promise(() => { });
        };

        // ----------- Procesing time

        const options = _isObject(args[0]/* !ORDER 1 */) ? { ...args.shift() } : {};
        const frameClosure = typeof args[0]/* !ORDER 2 */ === 'function' ? args.shift() : null;

        if ('status' in options) {
            options.status = parseInt(options.status);
            if (options.status < 200 || options.status > 599) {
                throw new Error(`The status provided (${options.status}) is outside the range [200, 599].`);
            }
        }
        if ('statusText' in options) {
            options.statusText = String(options.statusText);
        }
        if (options.headers && !(options.headers instanceof Headers)) {
            options.headers = new Headers(options.headers);
        }

        // ----------- Dispatch time

        let donePromise;

        if (/Response/.test(this.constructor.test(body))) {
            if (frameClosure) {
                throw new Error(`frameClosure is not supported for responses.`);
            }
            donePromise = await execReplaceWithResponse(body, options);
        } else if (this.constructor.test(body) === 'Generator') {
            if (frameClosure) {
                throw new Error(`frameClosure is not supported for generators.`);
            }
            donePromise = await execReplaceWithGenerator(body, options);
        } else if (this.constructor.test(body) === 'LiveProgramHandle') {
            if (frameClosure) {
                throw new Error(`frameClosure is not supported for live program handles.`);
            }
            donePromise = await execReplaceWithLiveProgramHandle(body, options);
        } else {
            donePromise = wrapReplaceWith(body, options);
            if (frameClosure) {
                const reactiveProxy = _isTypeObject(body) && !isTypeStream(body)
                    ? Observer.proxy(body, { chainable: true, membrane: body })
                    : body;
                donePromise = Promise.resolve(frameClosure.call(this, reactiveProxy));
            }
        }

        // Lifecycle time

        this.#extendLifecycle(options.done === false ? new Promise(() => { }) : donePromise);
        
        return await new Promise((resolve, reject) => {
            this.#abortController.signal.addEventListener('abort', resolve);
            donePromise.then(() => resolve());
            donePromise.catch((e) => reject(e));
        });
    }

    // ----------- Conversions

    toResponse({ client: clientPort, signal: abortSignal } = {}) {
        if (clientPort && !(clientPort instanceof MessagePortPlus)) {
            throw new Error('Client must be a MessagePortPlus interface');
        }

        const response = ResponsePlus.from(this.body, {
            status: this.status,
            statusText: this.statusText,
            headers: this.headers,
        });

        const responseMeta = _meta(this);
        _wq(response).set('meta', responseMeta);

        if (clientPort && this.readyState === 'live') {
            let undoInitialProjectMutations;
            if (_isTypeObject(this.body) && !isTypeStream(this.body)) {
                undoInitialProjectMutations = clientPort.projectMutations({
                    from: this.body,
                    to: 'initial_response',
                    signal: abortSignal/* stop observing mutations on body when we abort */
                });
            }

            const replaceHandler = () => {
                undoInitialProjectMutations?.();
                undoInitialProjectMutations = null;

                const headers = Object.fromEntries([...this.headers.entries()]);

                if (headers?.['set-cookie']) {
                    delete headers['set-cookie'];
                    console.warn('Warning: The "set-cookie" header is not supported for security reasons and has been removed from the response.');
                }

                clientPort.postMessage({
                    body: this.body,
                    status: this.status,
                    statusText: this.statusText,
                    headers,
                    done: this.readyState === 'done',
                }, { type: 'response.replace', live: true/*gracefully ignored if not an object*/, signal: this.#abortController.signal/* stop observing mutations on body a new body takes effect */ });
            };

            this.addEventListener('replace', replaceHandler, { signal: abortSignal/* stop listening when we abort */ });
        }

        return response;
    }

    async * toGenerator({ signal: abortSignal } = {}) {
        do {
            yield this.body;
        } while (await new Promise((resolve) => {
            this.addEventListener('replace', () => resolve(true), { once: true, signal: abortSignal });
            this.readyStateChange('done').then(() => resolve(false));
        }));
    }

    toLiveProgramHandle({ signal: abortSignal } = {}) {
        const handle = new LiveProgramHandleX;
        
        const replaceHandler = () => Observer.defineProperty(handle, 'value', { value: this.body, enumerable: true, configurable: true });
        this.addEventListener('replace', replaceHandler, { signal: abortSignal });
        replaceHandler();

        return handle;
    }

    clone(init = {}) {
        const clone = new this.constructor();

        const responseMeta = _meta(this);
        _wq(clone).set('meta', responseMeta);

        clone.replaceWith(this, init);
        return clone;
    }
}

export const isGenerator = (obj) => {
    return typeof obj?.next === 'function' &&
        typeof obj?.throw === 'function' &&
        typeof obj?.return === 'function';
};

export function getReadyStateInternals() {
    const portPlusMeta = _meta(this);
    if (!portPlusMeta.has('readystate_registry')) {
        const $ref = (o) => {
            o.promise = new Promise((res, rej) => (o.resolve = res, o.reject = rej));
            return o;
        };
        portPlusMeta.set('readystate_registry', {
            live: $ref({}),
            done: $ref({}),
        });
    }
    return portPlusMeta.get('readystate_registry');
}

class LiveProgramHandleX {
    [Symbol.toStringTag] = 'LiveProgramHandle';
    abort() { }
}
