import { expect } from 'chai';
import { BroadcastChannelPlus, Observer } from '@webqit/port-plus';
import { LiveResponse } from '../src/LiveResponse.js';

describe('LiveResponse Integration Tests (Background Ports)', function () {

    describe('Simulation via direct Port Manipulation', function () {
        async function setupWire() {
            const portID = 'test-channel-' + Math.random().toString(36).substring(7);

            // 1. Setup port
            const serverSideClientPort = new BroadcastChannelPlus(portID, {
                clientServerMode: 'server',
                postAwaitsOpen: true,
                autoStart: true // Ensure it's ready to accept connections
            });

            // ------------

            // 2. Transport layer response
            const response = new Response('initial content', {
                headers: { 'X-Message-Port': `channel://${portID}` }
            });

            // ------------

            // 3. Client-side response
            const liveResponseB = LiveResponse.from(response);
            await liveResponseB.readyStateChange('live');

            // 4. Take records
            const clientSideResult = [];
            liveResponseB.addEventListener('replace', (e) => {
                clientSideResult.push(liveResponseB.body);
            });

            return [serverSideClientPort, liveResponseB, clientSideResult];
        }

        it('should simulate response.replace via a background port', async function () {
            const [serverSideClientPort, liveResponseB, clientSideResult] = await setupWire();

            // ----- Server-side ----- 
            serverSideClientPort.postMessage({
                body: 'pushed content 1',
            }, { type: 'response.replace' });
            serverSideClientPort.postMessage({
                body: 'pushed content 2',
            }, { type: 'response.replace' });
            // ----- End: Server-side

            // ----- Transport latency ----- 
            await new Promise((r) => setTimeout(r, 10));
            // ----- End: Transport latency

            // ----- Client-side ----- 
            expect(clientSideResult[0]).to.equal('pushed content 1');
            expect(clientSideResult[1]).to.equal('pushed content 2');

            await new Promise((r) => setTimeout(r, 0));

            // Server did not explicitly post a response.done message
            expect(liveResponseB.readyState).to.equal('live');
            // ----- End: Client-side
        });

        it('should be done when server specifies done in last message', async function () {
            const [serverSideClientPort, liveResponseB, clientSideResult] = await setupWire();

            // ----- Server-side ----- 
            serverSideClientPort.postMessage({
                body: 'pushed content 1',
            }, { type: 'response.replace' });
            serverSideClientPort.postMessage({
                body: 'pushed content 2'
            }, { type: 'response.replace' });
            serverSideClientPort.postMessage(null, { type: 'response.done' });
            // ----- End: Server-side

            // ----- Transport latency ----- 
            await new Promise((r) => setTimeout(r, 10));
            // ----- End: Transport latency

            // ----- Client-side -----
            expect(clientSideResult[0]).to.equal('pushed content 1');
            expect(clientSideResult[1]).to.equal('pushed content 2');

            await new Promise((r) => setTimeout(r, 0));

            // Server did explicitly post a response.done message
            expect(liveResponseB.readyState).to.equal('done');
            // ----- End: Client-side
        });

        it('should project Live Objects', async function () {
            const [serverSideClientPort, liveResponseB, clientSideResult] = await setupWire();

            const obj1 = { a: 1, b: 2 };
            const obj2 = { a: 2, b: 3 };
            const obj3 = { a: 3, b: 4 };
            const concurrencyController = new AbortController;

            // ---- First Live Object ----

            // Replacement + live-projection on the server side
            serverSideClientPort.postMessage({
                body: obj1,
                concurrent: true,
            }, { type: 'response.replace', live: true, signal: concurrencyController.signal });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1);
            expect(liveResponseB.concurrent).to.true;

            // Mutate on the server side
            Observer.set(obj1, 'c', 3);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1);

            // ---- Second Live Object ----

            // Replacement + live-projection on the server side
            serverSideClientPort.postMessage({
                body: obj2,
                concurrent: true,
            }, { type: 'response.replace', live: true, signal: concurrencyController.signal });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[1]).to.eql(obj2);
            expect(liveResponseB.concurrent).to.true;

            // Mutate on the server side
            Observer.set(obj2, 'c', 6);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[1]).to.eql(obj2);

            // ---- Concurrency ----

            // Mutate on the server side
            Observer.set(obj1, 'd', 10); // NOTE: 1
            Observer.set(obj2, 'd', 20);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1); // NOTE: 1
            expect(clientSideResult[1]).to.eql(obj2);

            // NOTE: 1 – Second replacement+live projection being concurrent means that the previous live object projection has not been terminated by us on the server.

            // Server did not explicitly post a response.done message
            expect(liveResponseB.readyState).to.equal('live');

            // ---- Third Live Object ----

            concurrencyController.abort();

            // Replacement + live-projection on the server side
            serverSideClientPort.postMessage({
                body: obj3,
                concurrent: false,
            }, { type: 'response.replace', live: true, signal: null });
            serverSideClientPort.postMessage(null, { type: 'response.done' });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[2]).to.eql(obj3);
            expect(liveResponseB.concurrent).to.false;

            // Mutate on the server side
            Observer.set(obj2, 'c', 6);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[1]).to.eql(obj2);

            // Server did explicitly post a response.done message
            expect(liveResponseB.readyState).to.equal('done');

            // ---- Concurrency & Continuity ----

            // Mutate on the server side
            Observer.set(obj1, 'd', 11); // NOTE: 1
            Observer.set(obj2, 'd', 21); // NOTE: 1
            Observer.set(obj3, 'd', 22); // NOTE: 2

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.not.eql(obj1); // NOTE: 1
            expect(clientSideResult[1]).to.not.eql(obj2); // NOTE: 1
            expect(clientSideResult[2]).to.eql(obj3); // NOTE: 2

            // NOTE: 1 – Third replacement+live projection being non-concurrent means that the previous live object projection has been terminated by us on the server and sp should be discontinued on the client.
            // NOTE: 2 – Third replacement+live projection remains live even tho it's last in the series of "responses" – denoted by the server's "response.done" message
            // – until the server terminates the live projection or until port closes.
        });

    });

    describe('LiveResponse End-to-End Tests', function () {
        async function setupWire() {
            const portID = 'test-channel-' + Math.random().toString(36).substring(7);

            // 1. Setup port
            const serverSideClientPort = new BroadcastChannelPlus(portID, {
                clientServerMode: 'server',
                postAwaitsOpen: true,
                autoStart: true // Ensure it's ready to accept connections
            });

            // 2. Server-side LiveResponse
            const liveResponseA = new LiveResponse('initial content', { done: false });

            // ------------

            // 3. Transport layer Response
            const response = liveResponseA.toResponse({ port: serverSideClientPort, signal: undefined });
            response.headers.set('X-Message-Port', 'channel://' + portID);

            // ------------

            // 4. Client-side LiveResponse
            const liveResponseB = new LiveResponse(response);
            await liveResponseB.readyStateChange('live');

            // 5. Take records
            const clientSideResult = [];
            liveResponseB.addEventListener('replace', (e) => {
                clientSideResult.push(liveResponseB.body);
            });

            return [liveResponseA, liveResponseB, clientSideResult];
        }

        it('should simulate response.replace via a background port', async function () {
            const [liveResponseA, liveResponseB, clientSideResult] = await setupWire();

            // ----- Server-side -----
            await liveResponseA.replaceWith('pushed content 1', { done: false });
            await liveResponseA.replaceWith('pushed content 2', { done: false });
            // ----- End: Server-side -----

            // ----- Transport latency -----
            await new Promise((r) => setTimeout(r, 20));
            // ----- End: Transport latency -----

            // ----- Client-side -----
            expect(clientSideResult[0]).to.equal('pushed content 1');
            expect(clientSideResult[1]).to.equal('pushed content 2');

            await new Promise((r) => setTimeout(r, 20));

            // Server did specify "done: false" in last message
            expect(liveResponseB.readyState).to.equal('live');
            // ----- End: Client-side -----
        });

        it('should be done when server specifies done in last message', async function () {
            const [liveResponseA, liveResponseB, clientSideResult] = await setupWire();

            // ----- Server-side -----
            liveResponseA.replaceWith('pushed content 1', { done: false });
            liveResponseA.replaceWith('pushed content 2');
            // ----- End: Server-side -----

            // ----- Transport latency -----
            await new Promise((r) => setTimeout(r, 10));
            // ----- End: Transport latency -----

            // ----- Client-side -----
            expect(clientSideResult[0]).to.equal('pushed content 1');
            expect(clientSideResult[1]).to.equal('pushed content 2');

            await new Promise((r) => setTimeout(r, 20));

            // Server did not specify "done: false" in last message
            expect(liveResponseB.readyState).to.equal('done');
            // ----- End: Client-side -----
        });

        it('should project Live Objects', async function () {
            const [liveResponseA, liveResponseB, clientSideResult] = await setupWire();

            const obj1 = { a: 1, b: 2 };
            const obj2 = { a: 2, b: 3 };
            const obj3 = { a: 3, b: 4 };

            // ---- First Live Object ----

            // Replacement + live-projection on the server side
            await liveResponseA.replaceWith(obj1, { concurrent: true, done: false });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1);
            expect(liveResponseB.concurrent).to.true;

            // Mutate on the server side
            Observer.set(obj1, 'c', 3);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1);

            // ---- Second Live Object ----

            // Replacement + live-projection on the server side
            await liveResponseA.replaceWith(obj2, { concurrent: true, done: false });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[1]).to.eql(obj2);
            expect(liveResponseB.concurrent).to.true;

            // Mutate on the server side
            Observer.set(obj2, 'c', 6);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[1]).to.eql(obj2);

            // ---- Concurrency ----

            // Mutate on the server side
            Observer.set(obj1, 'd', 10); // NOTE: 1
            Observer.set(obj2, 'd', 20);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1); // NOTE: 1
            expect(clientSideResult[1]).to.eql(obj2);

            // NOTE: 1 – Second replacement+live projection being concurrent means that the previous live object projection has not been terminated by us on the server.

            // Server did specify "done: false" in last message
            expect(liveResponseB.readyState).to.equal('live');

            // ---- Third Live Object ----

            // Replacement + live-projection on the server side
            await liveResponseA.replaceWith(obj3, { concurrent: false });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[2]).to.eql(obj3);
            expect(liveResponseB.concurrent).to.false;

            // Mutate on the server side
            Observer.set(obj2, 'c', 6);

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[1]).to.eql(obj2);

            // Server did not specify "done: false" in last message
            expect(liveResponseB.readyState).to.equal('done');

            // ---- Concurrency & Continuity ----

            // Mutate on the server side
            Observer.set(obj1, 'd', 11); // NOTE: 1
            Observer.set(obj2, 'd', 21); // NOTE: 1
            Observer.set(obj3, 'd', 22); // NOTE: 2

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.not.eql(obj1); // NOTE: 1
            expect(clientSideResult[1]).to.not.eql(obj2); // NOTE: 1
            expect(clientSideResult[2]).to.eql(obj3); // NOTE: 2

            // NOTE: 1 – Third replacement+live projection being non-concurrent means that the previous live object projection has been terminated by us on the server and sp should be discontinued on the client.
            // NOTE: 2 – Third replacement+live projection remains live even tho it's last in the series of "responses" – denoted by the server's "response.done" message
            // – until the server terminates the live projection or until port closes.
        });

        it('should project Live Objects – advanced pipelines', async function () {
            const [liveResponseA, liveResponseB, clientSideResult] = await setupWire();

            const obj1 = { a: 1, b: 2 };
            const obj2 = { a: 2, b: 3 };
            const obj3 = { a: 3, b: 4 };

            // ---- First Live Object ----

            // Replacement + live-projection on the server side
            await liveResponseA.replaceWith(obj1, async ($obj1) => {
                await new Promise((r) => setTimeout(r, 0));
                $obj1.c = 3;
            }, { concurrent: true, done: false });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 20));
            expect(clientSideResult[0]).to.eql(obj1);
            expect(liveResponseB.concurrent).to.true;

            // ---- Second Live Object ----

            // Replacement + live-projection on the server side
            await liveResponseA.replaceWith((async function* gen() {
                yield obj2;

                await new Promise((r) => setTimeout(r, 2));
                // Mutate obj2 even after having returned it
                Observer.set(obj2, 'c', 6);
                await new Promise((r) => setTimeout(r, 2));

                (new Promise((r) => setTimeout(r, 2))).then(() => {
                    // Mutate obj3 even after having returned it
                    Observer.set(obj3, 'c', 60);
                });

                return obj3;
            })(), { concurrent: true, done: false });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 30));
            expect(clientSideResult[1]).to.eql(obj2);
            expect(clientSideResult[2]).to.eql(obj3);

            // Replace with a LiveResponse instance itself

            const obj4 = { a: 2, b: 3 };
            const obj5 = { a: 3, b: 4 };

            await liveResponseA.replaceWith(LiveResponse.from((async function* gen() {
                yield obj4;

                await new Promise((r) => setTimeout(r, 2));
                // Mutate obj2 even after having returned it
                Observer.set(obj4, 'c', 6);
                await new Promise((r) => setTimeout(r, 2));

                (new Promise((r) => setTimeout(r, 2))).then(() => {
                    // Mutate obj3 even after having returned it
                    Observer.set(obj5, 'c', 60);
                });

                return obj5;
            })()), { concurrent: true });

            // Inspect on the client side
            await new Promise((r) => setTimeout(r, 30));
            expect(clientSideResult[3]).to.eql(obj4);
            expect(clientSideResult[4]).to.eql(obj5);

            // The nested LiveResponse is essentially flattened out

            // We should be done at this point
            expect(liveResponseB.readyState).to.equal('done');
        });
    });

});

