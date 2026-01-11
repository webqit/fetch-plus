import { _isObject, _isTypeObject } from '@webqit/util/js/index.js';
import { Observer, ListenerRegistry, Descriptor } from '@webqit/observer';
import { BroadcastChannelPlus, WebSocketPort, MessagePortPlus } from '@webqit/port-plus';
import { isTypeStream, _meta, _wq } from './messageParserMixin.js';
import { ResponsePlus } from './ResponsePlus.js';

export class LiveResponse extends EventTarget {

    get [Symbol.toStringTag]() {
        return 'LiveResponse';
    }

    static [Symbol.hasInstance](instance) {
        return instance instanceof EventTarget
            && instance?.[Symbol.toStringTag] === 'LiveResponse'
            && typeof instance.replaceWith === 'function'
            && typeof instance.now === 'function';
    }

    static get xHeaderName() {
        return 'X-Message-Port';
    }

    static test(unknown) {
        if (unknown instanceof LiveResponse) {
            return 'LiveResponse';
        }
        if (unknown instanceof LiveProgramHandleX) {
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

    static hasPort(respone) {
        const responseMeta = _meta(respone);
        return !!responseMeta.get('port')
            || !!respone.headers?.get?.(this.xHeaderName)?.trim();
    }

    static getPort(respone, { handshake = 1 } = {}) {
        if (!(respone instanceof Response
            || respone instanceof LiveResponse)) {
            return;
        }

        const responseMeta = _meta(respone);

        if (!responseMeta.has('port')) {
            const value = respone.headers.get(this.xHeaderName)?.trim();
            if (!value) return;

            const [, scheme, portID] = /^(socket|channel):\/\/(.*)$/.exec(value) || [];
            if (!scheme || !portID) {
                throw new Error(`Unknown port messaging protocol: ${value}`);
            }

            const port = scheme === 'channel'
                ? new BroadcastChannelPlus(portID, { handshake, postAwaitsOpen: true, clientServerMode: 'client' })
                : new WebSocketPort(portID, { handshake, postAwaitsOpen: true });

            responseMeta.set('port', port);
        }

        return responseMeta.get('port');
    }

    static attachPort(respone, port) {
        if (port && !(port instanceof MessagePortPlus)) {
            throw new Error('Client must be a MessagePortPlus interface');
        }
        if (respone instanceof LiveResponse) {
            respone.#port = port;
            return;
        }
        const responseMeta = _meta(respone);
        responseMeta.set('port', port);
    }

    static from(data, ...args) {
        if (data instanceof LiveResponse) {
            return data.clone(...args);
        }
        return new this(data, ...args);
    }

    /* INSTANCE */

    #listenersRegistry;
    #readyStates;

    #abortController = new AbortController;
    #concurrencyAbortController = new AbortController;

    constructor(body, ...args) {
        super();
        this.#listenersRegistry = ListenerRegistry.getInstance(this, true);

        const $ref = (o) => {
            o.promise = new Promise((res, rej) => (o.resolve = res, o.reject = rej));
            return o;
        };
        this.#readyStates = {
            live: $ref({}),
            done: $ref({}),
        };
        const readyStates = this.#readyStates;
        (function refresh() {
            readyStates.now = $ref({});
            readyStates.now.refresh = refresh;
            return readyStates.now;
        })();

        const frame = this.#readyStates.now;
        this.#replaceWith(frame, body, ...args).catch((e) => {
            frame.reject(e);
        });
    }

    /* Level 1 props */

    #body = null;
    get body() { return this.#body; }

    #concurrent = false;
    get concurrent() { return this.#concurrent; }

    get bodyUsed() { return true; }

    #headers = new Headers;
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

    get ok() { return !!(this.#status >= 200 && this.#status < 299); }

    /* Level 3 props */

    #port;
    get port() { return this.#port; }

    // Lifecycle

    get readyState() {
        return this.#readyStates.done.state ? 'done'
            : (this.#readyStates.live.state ? 'live' : 'waiting');
    }

    readyStateChange(query) {
        if (!['live', 'now', 'done'].includes(query)) {
            throw new Error(`Invalid readyState query "${query}"`);
        }
        return this.#readyStates[query].promise;
    }

    disconnect(dispose = false) {
        this.#abortController.abort();
        this.#abortController = new AbortController;
        if (dispose) {
            this.#concurrencyAbortController.abort();
            this.#concurrencyAbortController = new AbortController;
        }
    }

    #currentFramePromise;
    #extendLifecycle(promise) {
        if (this.#readyStates.done.state) {
            throw new Error('Response already done.');
        }
        this.#currentFramePromise = promise;
        promise.then((value) => {
            if (this.#currentFramePromise === promise) {
                this.#currentFramePromise = null;
                this.#readyStates.done.state = true;
                this.#readyStates.done.resolve(value);
            }
        }).catch((e) => {
            if (this.#currentFramePromise === promise) {
                this.#currentFramePromise = null;
                this.#readyStates.done.state = true;
                this.#readyStates.done.reject(e);
            }
        });
        return promise;
    }

    async now() { return this.#readyStates.now.promise; }

    async replaceWith(body, ...args) {
        if (this.readyState === 'done') {
            throw new Error('Response already done.');
        }
        this.disconnect(); // Disconnect from existing source if any
        await this.#replaceWith(null, body, ...args);
    }

    async #replaceWith(__frame, body, ...args) {
        const frame = __frame || this.#readyStates.now.refresh();

        // ----------- Promise input

        if (body instanceof Promise) {
            return this.#extendLifecycle(new Promise((resolve, reject) => {
                this.#abortController.signal.addEventListener('abort', () => {
                    frame.aborted = true;
                    resolve();
                });

                body.then(async (resolveData) => {
                    await this.#replaceWith(frame, resolveData, ...args);
                    resolve();
                }).catch((e) => reject(e));
            }));
        }

        // ----------- Formatters

        const directReplaceWith = (__frame, responseFrame) => {
            responseFrame = Object.freeze({
                ...responseFrame,
                ok: !!(responseFrame.status >= 200 && responseFrame.status < 299),
                bodyUsed: true,
            });

            if (__frame?.aborted) {
                __frame.resolve(responseFrame);
                return;
            }

            const frame = __frame || this.#readyStates.now.refresh();

            const $body = responseFrame.body;

            this.#status = responseFrame.status;
            this.#statusText = responseFrame.statusText;

            for (const [name] of [/*IMPORTANT*/...this.#headers.entries()]) { // for some reason, some entries not produced when not spread
                this.#headers.delete(name);
            }
            for (const [name, value] of responseFrame.headers.entries()) {
                this.#headers.append(name, value);
            }

            this.#type = responseFrame.type;
            this.#redirected = responseFrame.redirected;
            this.#url = responseFrame.url;

            const bodyOld = this.#body;
            this.#body = $body;
            this.#concurrent = !!responseFrame.concurrent;

            this.#port = responseFrame.port;

            if (!this.#concurrent) {
                this.#concurrencyAbortController.abort();
                this.#concurrencyAbortController = new AbortController;
            }

            const descriptor = new Descriptor(this, {
                type: 'set',
                key: 'body',
                value: $body,
                oldValue: bodyOld,
                isUpdate: true,
                related: [],
                operation: 'set',
                detail: null,
            });

            // Must come first so that observers below here see this state

            this.#readyStates.live.state = true;
            this.#readyStates.live.resolve(this);

            // May trigger "done" ready state
            frame.resolve(responseFrame);

            // Must come after all property assignments above because it fires events
            this.#listenersRegistry.emit([descriptor]);
            this.dispatchEvent(new ReplaceEvent(responseFrame));
        };

        const wrapReplaceWith = (frame, body, options) => {
            directReplaceWith(frame, {
                body,
                status: 200,
                statusText: '',
                ...options,
                headers: options.headers instanceof Headers ? options.headers : new Headers(options.headers || {}),
                type: 'basic',
                redirected: false,
                url: null
            });
        };

        // ----------- "Response" handler

        const execReplaceWithResponse = async (frame, response, options) => {
            let body, port, jsonSuccess = true;
            if (response instanceof Response) {
                try {
                    body = await ResponsePlus.prototype.any.call(response, { to: 'json' });
                } catch (e) {
                    jsonSuccess = false;
                    body = await ResponsePlus.prototype.any.call(response);
                }
                port = this.constructor.getPort(response, { handshake: 2 });
            } else {
                body = (await response.readyStateChange('live')).body;
                port = response.port;
            }
            directReplaceWith(frame, {
                body,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers,
                concurrent: response.concurrent, // for response === LiveResponse
                ...options,
                port,
                type: response.type,
                redirected: response.redirected,
                url: response.url,
            });

            if (response instanceof LiveResponse) {
                const replaceHandler = () => {
                    wrapReplaceWith(null, response.body, response);
                };
                response.addEventListener('replace', replaceHandler, { signal: this.#abortController.signal });
                await response.readyStateChange('done');
                response.removeEventListener('replace', replaceHandler);
                return response;
            }

            if (port) {
                // Bind to upstream mutations
                if (jsonSuccess) {
                    port.projectMutations({
                        from: 'initial_response',
                        to: body,
                        signal: this.#concurrencyAbortController.signal
                    });
                }

                // Bind to replacements
                const returnValue = new Promise((resolve) => {
                    const replaceHandler = (e) => {
                        const { body, ...options } = e.data;
                        wrapReplaceWith(null, body, { ...options });
                    };
                    port.addEventListener('response.replace', replaceHandler, { signal: this.#abortController.signal });
                    port.addEventListener('response.done', () => {
                        port.removeEventListener('response.replace', replaceHandler);
                        resolve(this);
                    }, { once: true });
                    port.readyStateChange('close').then(resolve);
                });

                // Must come after having listened to events
                port.start();

                return returnValue;
            }
        };

        // ----------- "Generator" handler

        const execReplaceWithGenerator = async (frame, gen, options) => {
            const firstFrame = await gen.next();
            const firstValue = await firstFrame.value;

            await this.#replaceWith(frame, firstValue, { done: firstFrame.done, ...options });
            // this is the first time options has a chance to be applied

            let generatorFrame = firstFrame;
            let value = firstValue;

            while (!generatorFrame.done && !this.#abortController.signal.aborted) {
                generatorFrame = await gen.next();
                value = await generatorFrame.value;
                if (!this.#abortController.signal.aborted) {
                    await this.#replaceWith(null, value, { concurrent: options.concurrent, done: options.done === false ? false : generatorFrame.done });
                    // top-level false need to be respected: means keep instance alive even when done
                }
            }
        };

        // ----------- "LiveProgramHandle" handler

        const execReplaceWithLiveProgramHandle = async (frame, liveProgramHandle, options) => {
            await this.#replaceWith(frame, liveProgramHandle.value, options);
            // this is the first time options has a chance to be applied

            Observer.observe(
                liveProgramHandle,
                'value',
                (e) => this.#replaceWith(null, e.value, { concurrent: options.concurrent, done: false }),
                // we're never done unless explicitly aborted
                { signal: this.#abortController.signal }
            );

            return new Promise(() => { });
        };

        // ----------- Procesing time

        const frameClosure = typeof args[0]/* !ORDER 1 */ === 'function' ? args.shift() : null;
        const frameOptions = _isObject(args[0]/* !ORDER 2 */) ? { ...args.shift() } : {};

        if ('status' in frameOptions) {
            frameOptions.status = parseInt(frameOptions.status);
            if (frameOptions.status < 200 || frameOptions.status > 599) {
                throw new Error(`The status provided (${frameOptions.status}) is outside the range [200, 599].`);
            }
        }
        if ('statusText' in frameOptions) {
            frameOptions.statusText = String(frameOptions.statusText);
        }
        if (frameOptions.headers && !(frameOptions.headers instanceof Headers)) {
            frameOptions.headers = new Headers(frameOptions.headers);
        }
        if ('concurrent' in frameOptions) {
            frameOptions.concurrent = Boolean(frameOptions.concurrent);
        }

        // ----------- Dispatch time

        if (body instanceof Response
            || body instanceof LiveResponse) {
            if (frameClosure) {
                throw new Error(`frameClosure is not supported for responses.`);
            }
            frame.donePromise = execReplaceWithResponse(frame, body, frameOptions);
        } else if (isGenerator(body)) {
            if (frameClosure) {
                throw new Error(`frameClosure is not supported for generators.`);
            }
            frame.donePromise = execReplaceWithGenerator(frame, body, frameOptions);
        } else if (body instanceof LiveProgramHandleX) {
            if (frameClosure) {
                throw new Error(`frameClosure is not supported for live program handles.`);
            }
            frame.donePromise = execReplaceWithLiveProgramHandle(frame, body, frameOptions);
        } else {
            frame.donePromise = Promise.resolve(wrapReplaceWith(frame, body, frameOptions));
            if (frameClosure) {
                const reactiveProxy = _isTypeObject(body) && !isTypeStream(body)
                    ? Observer.proxy(body, { chainable: true, membrane: body })
                    : body;
                frame.donePromise = Promise.resolve(frameClosure.call(this, reactiveProxy, this.#concurrencyAbortController.signal));
            }
        }

        // Lifecycle time

        this.#extendLifecycle(frameOptions.done === false ? new Promise(() => { }) : frame.donePromise);

        return await new Promise((resolve, reject) => {
            this.#abortController.signal.addEventListener('abort', () => resolve(false));
            frame.donePromise.then(() => resolve(true)).catch(reject);
        });
    }

    // ----------- Conversions

    toResponse({ port: clientPort, signal: abortSignal } = {}) {
        if (clientPort && !(clientPort instanceof MessagePortPlus)) {
            throw new Error('Client must be a MessagePortPlus interface');
        }

        const response = ResponsePlus.from(this.body, {
            status: this.#status,
            statusText: this.#statusText,
            headers: this.#headers,
        });

        const responseMeta = _meta(this);
        _wq(response).set('meta', new Map(responseMeta));

        if (!clientPort) return response;

        if (_isTypeObject(this.#body) && !isTypeStream(this.#body)) {
            clientPort.projectMutations({
                from: this.#body,
                to: 'initial_response',
                signal: AbortSignal.any([this.#concurrencyAbortController.signal].concat(abortSignal || []))/* stop observing mutations on body when we abort */
            });
        }

        const replaceHandler = () => {
            const headers = Object.fromEntries([...this.headers.entries()]);

            if (headers?.['set-cookie']) {
                delete headers['set-cookie'];
                console.warn('Warning: The "set-cookie" header is not supported for security reasons and has been removed from the response.');
            }

            clientPort.postMessage({
                body: this.#body,
                status: this.#status,
                statusText: this.#statusText,
                headers,
                type: this.type,
                url: this.url,
                redirect: this.redirect,
                concurrent: this.#concurrent,
            }, { type: 'response.replace', live: true/*gracefully ignored if not an object*/, signal: AbortSignal.any([this.#concurrencyAbortController.signal].concat(abortSignal || []))/* stop observing mutations on body a new body takes effect */ });
        };

        this.addEventListener('replace', replaceHandler, { signal: abortSignal/* stop listening when we abort */ });
        this.readyStateChange('done').then(() => {
            clientPort.postMessage(null, { type: 'response.done' });
        });

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

        const replaceHandler = () => Observer.defineProperty(handle, 'value', { value: this.body, enumerable: false, configurable: true });
        this.addEventListener('replace', replaceHandler, { signal: abortSignal });
        replaceHandler();

        return handle;
    }

    clone(init = {}) {
        const clone = new this.constructor();

        const responseMeta = _meta(this);
        _wq(clone).set('meta', new Map(responseMeta));

        clone.replaceWith(this, init);
        return clone;
    }
}

export const isGenerator = (obj) => {
    return typeof obj?.next === 'function' &&
        typeof obj?.throw === 'function' &&
        typeof obj?.return === 'function';
};

export class ReplaceEvent extends Event {

    [Symbol.toStringTag] = 'ReplaceEvent';

    static [Symbol.hasInstance](instance) {
        return instance instanceof Event
            && instance[Symbol.toStringTag] === 'ReplaceEvent';
    }

    #data;
    get data() { return this.#data; }

    constructor(responseFrame) {
        super('replace');
        this.#data = responseFrame;
    }
}

export class LiveProgramHandleX {
    [Symbol.toStringTag] = 'LiveProgramHandle';

    static [Symbol.hasInstance](instance) {
        return instance?.[Symbol.toStringTag] === 'LiveProgramHandle';
    }

    abort() { }
}
