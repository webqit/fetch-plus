import chai, { expect } from 'chai';
import chaiAsPromised from 'chai-as-promised';
chai.use(chaiAsPromised);
import { LiveResponse } from '../src/LiveResponse.js';
import Observer from '@webqit/observer';

describe('LiveResponse Basic Instance Tests', function () {

    it('should quak like a Response and EventTarget', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body);

        expect(liveResponse).to.be.instanceOf(EventTarget);
        expect(liveResponse.headers).to.exist;
    });

    it('should initialize synchronously for a "sync" body input', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body);

        expect(liveResponse.body).to.equal(body);
        expect(liveResponse.status).to.equal(200);
        expect(liveResponse.ok).to.be.true;

        expect((await liveResponse.now()).body).to.equal(body);
    });

    it('should switch readyState to "live" synchronously for a "sync" body input', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body);

        expect(liveResponse.readyState).to.equal('live');
        expect(liveResponse.body).to.equal(body);
    });

    it('should switch readyState to "done" asynchronously', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body);

        expect(liveResponse.readyState).to.equal('live');
        expect(liveResponse.body).to.equal(body);

        await new Promise((resolve) => setTimeout(() => resolve(), 0));

        expect(liveResponse.readyState).to.equal('done');
    });

    it('should have a .now() method that snapshots state synchronously and returns a promise that resolves to it', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body);

        expect(liveResponse.readyState).to.equal('live');
        expect(liveResponse.body).to.equal(body);

        expect((await liveResponse.now()).body).to.equal(body);

        expect(liveResponse.readyState).to.equal('done');
    });

    it('should reject .replaceWith() if the response is aliveResponseeady done', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body);

        expect(liveResponse.readyState).to.equal('live');
        expect((await liveResponse.now()).body).to.equal(body);

        expect(liveResponse.readyState).to.equal('done');

        expect(liveResponse.replaceWith('final', { done: true })).to.be.rejectedWith(/Response aliveResponseeady done/);
    });

    it('should emit a "replace" event when the body is replaced. Fires synchronously for sync body inputs', function () {
        const liveResponse = new LiveResponse('initial');
        const sequence = [];

        liveResponse.addEventListener('replace', () => sequence.push('replace'));
        liveResponse.replaceWith('updated');
        sequence.push('done');

        expect(sequence[0]).to.equal('replace');
        expect(sequence[1]).to.equal('done');

        expect(liveResponse.body).to.equal('updated');
        expect(liveResponse.readyState).to.equal('live');
    });
});

describe('LiveResponse Async Body Tests', function () {

    it('should initialize asynchronously for an "async" body input', async function () {
        const body = 'Hello World';
        const p = new Promise((resolve) => setTimeout(() => resolve(body), 10));
        const liveResponse = new LiveResponse(p);

        expect(liveResponse.body).to.equal(null);
        expect(liveResponse.readyState).to.equal('waiting');

        await new Promise((resolve) => setTimeout(() => resolve(), 10));
        expect(liveResponse.readyState).to.equal('done');
        expect(liveResponse.body).to.equal(body);
    });

    it('should treat Response body inputs as async', async function () {
        const body = 'Hello World';

        const liveResponse = new LiveResponse(new Response(body));

        expect(liveResponse.body).to.equal(null);
        expect(liveResponse.readyState).to.equal('waiting');

        await new Promise((resolve) => setTimeout(() => resolve(), 20));
        expect(liveResponse.readyState).to.equal('done');
        expect(liveResponse.body).to.equal(body);
    });

    it('.now() should snapshot async body input synchronously and return a promise that resolves to it', async function () {
        const body = 'async body';
        const p = new Promise((resolve) => setTimeout(() => resolve(body), 10));
        const liveResponse = new LiveResponse(p);

        expect(liveResponse.body).to.equal(null);
        expect(liveResponse.readyState).to.equal('waiting');

        expect((await liveResponse.now()).body).to.equal(body);
        expect(liveResponse.readyState).to.equal('done');
    });

    it('.now() should successively snapshot synchronously and return a promise each that resolves to it', async function () {
        const frame1 = new Promise((resolve) => setTimeout(() => resolve('frame 1'), 10));
        const liveResponse = new LiveResponse(frame1, { done: false });
        const snapshot1 = liveResponse.now(); // Snapshot 'frame 1' while still resolving

        liveResponse.replaceWith('frame 2', { done: false }); // 'frame 1' is abanddoned now while still resolving
        const snapshot2 = liveResponse.now(); // Snapshot 'frame 2'

        const frame3 = new Promise((resolve) => setTimeout(() => resolve('frame 3'), 10));
        liveResponse.replaceWith(frame3, { done: false }); // 'frame 2' – which resolved synchronously – is replaced now
        const snapshot3 = liveResponse.now(); // Snapshot 'frame 3' while still resolving

        const frame4 = new Promise((resolve) => setTimeout(() => resolve('frame 4'), 10));
        liveResponse.replaceWith(frame4, { done: true }); // 'frame 3' is abanddoned now while still resolving
        const snapshot4 = liveResponse.now(); // Snapshot 'frame 4' while still resolving

        expect((await snapshot1).body).to.equal('frame 1');
        expect((await snapshot2).body).to.equal('frame 2');
        expect((await snapshot3).body).to.equal('frame 3');
        expect((await snapshot4).body).to.equal('frame 4');
    });
});

describe('LiveResponse Replacement Tests', function () {

    it('should keep readyState live when options.done is false (sync)', async function () {
        const body = 'Hello World';
        const liveResponse = new LiveResponse(body, { done: false });

        expect(liveResponse.body).to.equal(body);
        expect(liveResponse.readyState).to.equal('live');
        expect((await liveResponse.now()).body).to.equal(body);
        expect(liveResponse.readyState).to.equal('live');

        liveResponse.replaceWith('final', { done: true });

        expect(liveResponse.body).to.equal('final');
        expect(liveResponse.readyState).to.equal('live');
        expect((await liveResponse.now()).body).to.equal('final');
        expect(liveResponse.readyState).to.equal('done');
    });

    it('should keep readyState live when options.done is false (async)', async function () {
        const body = 'async body';
        const p = new Promise((resolve) => setTimeout(() => resolve(body), 10));
        const liveResponse = new LiveResponse(p, { done: false });

        expect(liveResponse.body).to.equal(null);
        expect(liveResponse.readyState).to.equal('waiting');
        expect((await liveResponse.now()).body).to.equal(body);
        expect(liveResponse.readyState).to.equal('live');

        const p2 = new Promise((resolve) => setTimeout(() => resolve('final'), 10));
        liveResponse.replaceWith(p2, { done: true });

        expect(liveResponse.body).to.equal(body);
        expect(liveResponse.readyState).to.equal('live');
        expect((await liveResponse.now()).body).to.equal('final');
        expect(liveResponse.readyState).to.equal('done');
    });

    it('should feed from a Generator object', async function () {
        const result = [];
        const liveResponse = new LiveResponse((async function* () {
            yield 'async body 1';
            return 'async body 2';
        })(), { done: false });

        liveResponse.addEventListener('replace', (event) => {
            result.push(liveResponse.body);
        });

        expect(liveResponse.body).to.equal(null);
        expect(liveResponse.readyState).to.equal('waiting');

        await liveResponse.readyStateChange('live'); // Allow for async body to be processed
        await new Promise((r) => setTimeout(r, 0)); // Allow for async body to be processed

        expect(result).to.eql(['async body 1', 'async body 2']);
        expect(liveResponse.readyState).to.equal('live'); // We expect the readyState to be live even when the gen is done – going by our options.done === false

        liveResponse.replaceWith((async function* () {
            const v = { value: 'final 1' };
            yield v;

            await new Promise((r) => setTimeout(r, 0));
            v.value = 'final 1 - tada';

            return 'final 2';
        })());

        await new Promise((r) => setTimeout(r, 10)); // Allow for async entries to be processed

        expect(result).to.eql(['async body 1', 'async body 2', { value: 'final 1 - tada' }, 'final 2']);
        expect(liveResponse.readyState).to.equal('done'); // We expect to be done now
    });

    it('should live state from a closure, then replace with a generator', async function () {
        const result = [];
        const initialState = { a: 'a' };
        const liveResponse = new LiveResponse(initialState, async function ($state, sig) {
            $state.b = 'b';
            await new Promise((r) => setTimeout(r, 10));
            if (sig.aborted) return;
            $state.c = 'c';
        }, { done: false });

        liveResponse.addEventListener('replace', (event) => {
            result.push(liveResponse.body);
        });

        expect(liveResponse.body).to.eql(initialState);
        expect(liveResponse.readyState).to.equal('live');

        await new Promise((r) => setTimeout(r, 5));

        liveResponse.replaceWith((async function* () {
            const v = { value: 'final 1' };
            yield v;

            await new Promise((r) => setTimeout(r, 0));
            v.value = 'final 1 - tada';

            return 'final 2';
        })());

        await new Promise((r) => setTimeout(r, 10)); // Allow for async entries to be processed

        expect(initialState).to.eql({ a: 'a', b: 'b' }); // When we replaced the generator, sig.aborted fired, so $state.c was never set

        expect(result).to.eql([{ value: 'final 1 - tada' }, 'final 2']);
        expect(liveResponse.readyState).to.equal('done'); // We expect to be done now
    });
});
