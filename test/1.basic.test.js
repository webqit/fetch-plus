import { expect } from 'chai';
import { HeadersPlus } from '../src/HeadersPlus.js';
import { RequestPlus } from '../src/RequestPlus.js';
import { ResponsePlus } from '../src/ResponsePlus.js';
import { FormDataPlus } from '../src/FormDataPlus.js';
import { fetchPlus } from '../src/fetchPlus.js';

describe('Core API Tests', function () {

    describe('HeadersPlus', function () {
        it('should parse "Cookie" request headers', function () {
            const headers = new HeadersPlus({
                'Cookie': 'name=value; name2=value2'
            });
            const cookies = headers.get('Cookie', true);
            expect(cookies).to.be.an('array').with.lengthOf(2);
            expect(cookies[0]).to.deep.include({ name: 'name', value: 'value' });
            expect(cookies[1]).to.deep.include({ name: 'name2', value: 'value2' });
        });

        it('should parse "Set-Cookie" response headers', function () {
            // Note: Native Headers object often combines multiple Set-Cookie headers oddly or hides them,
            // but HeadersPlus aims to handle them if possible or at least parse single strings.
            // Let's test basic single parsing first as multiple Set-Cookie support varies by environment (Node vs Browser).
            const headers = new HeadersPlus();
            headers.append('Set-Cookie', 'session=123; Secure; Path=/');

            // getSetCookie might be polyfilled or native
            const cookies = headers.get('Set-Cookie', true);
            expect(cookies).to.be.an('array');
            expect(cookies[0]).to.deep.include({ name: 'session', value: '123' });
            expect(cookies[0]).to.have.property('secure', true);
            expect(cookies[0]).to.have.property('path', '/');
        });

        it('should parse "Range" headers', function () {
            const headers = new HeadersPlus({
                'Range': 'bytes=0-499, 500-999'
            });
            const ranges = headers.get('Range', true);
            expect(ranges).to.have.lengthOf(2);
            expect(ranges[0]).to.deep.equal([0, 499]);
            expect(ranges[1]).to.deep.equal([500, 999]);
        });

        it('should parse "Accept" headers and match mime types', function () {
            const headers = new HeadersPlus({
                'Accept': 'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8'
            });
            const accept = headers.get('Accept', true);

            expect(accept).to.deep.equal([
                ['text/html', 1],
                ['application/xhtml+xml', 1],
                ['application/xml', 0.9],
                ['*/*', 0.8],
            ]);
            expect(accept.toString()).to.equal('text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8');
            expect(accept.match('text/html')).to.equal(1);
            expect(accept.match('application/xml')).to.equal(0.9);
            expect(accept.match('image/png')).to.equal(0.8); // Matches */*
        });
    });

    describe('HeadersPlus (Extended)', function () {
        it('should parse multi-range headers', function () {
            const headers = new HeadersPlus({
                'Range': 'bytes=0-50, 60-100'
            });
            const ranges = headers.get('Range', true);
            expect(ranges).to.have.lengthOf(2);
            expect(ranges[0]).to.deep.equal([0, 50]);
            expect(ranges[1]).to.deep.equal([60, 100]);
        });

        it('should validate and render ranges', function () {
            const headers = new HeadersPlus({
                'Range': 'bytes=0-500'
            });
            const range = headers.get('Range', true)[0];

            // Validate against total length
            expect(range.canResolveAgainst(0, 1000)).to.be.true;
            expect(range.canResolveAgainst(500, 1000)).to.be.false; // Start > 0 is fine, but range covers 0-500? 
            // wait, canResolveAgainst(currentStart, totalLength) checks if the range is valid for the current content?
            // "range[0] < currentStart" is check.
            // If currentStart is 500, range 0-499 is NOT valid

            expect(range.canResolveAgainst(0, 400)).to.be.false; // range end > total

            // Render
            // range is [0, 499]
            const rendered = range.resolveAgainst(1000);
            expect(rendered).to.deep.equal([0, 499]);
        });

        it('should handle open-ended ranges', function () {
            const headers = new HeadersPlus({ 'Range': 'bytes=500-' });
            const range = headers.get('Range', true)[0];
            // [500, null]

            const rendered = range.resolveAgainst(1000);
            expect(rendered).to.deep.equal([500, 999]);
        });

        it('should handle multiple Set-Cookie headers', function () {
            const headers = new HeadersPlus();
            headers.append('Set-Cookie', 'a=1; Path=/');
            headers.append('Set-Cookie', 'b=2; Secure');

            const cookies = headers.get('Set-Cookie', true);
            expect(cookies).to.be.an('array').with.lengthOf(2);
            expect(cookies[0]).to.deep.include({ name: 'a', value: '1' });
            expect(cookies[1]).to.deep.include({ name: 'b', value: '2' });
        });

        it('should return 0 for matching unknown types in Accept header without wildcard', function () {
            const headers = new HeadersPlus({
                'Accept': 'text/html, application/json;q=0.9'
            });
            const accept = headers.get('Accept', true);

            expect(accept.match('text/html')).to.equal(1);
            expect(accept.match('image/png')).to.equal(0);
        });
    });

    describe('RequestPlus & ResponsePlus', function () {
        it('should support upgradeInPlace for Request', function () {
            const req = new Request('http://example.com');
            expect(req).to.not.be.instanceOf(RequestPlus);

            RequestPlus.upgradeInPlace(req);
            expect(req).to.be.instanceOf(RequestPlus);

            expect(req.headers).to.be.instanceOf(Headers); // It is still headers
            expect(req.headers).to.be.instanceOf(HeadersPlus); // It is now also headersPlus

            req.headers.set('Range', 'bytes=0-100');
            const range = req.headers.get('Range', true); // Should return array if upgraded
            expect(range).to.be.an('array');
        });

        it('should support upgradeInPlace for Response', function () {
            const res = new Response('body');
            expect(res).to.not.be.instanceOf(ResponsePlus);

            ResponsePlus.upgradeInPlace(res);
            expect(res).to.be.instanceOf(ResponsePlus);

            expect(res.headers).to.be.instanceOf(Headers); // It is still headers
            expect(res.headers).to.be.instanceOf(HeadersPlus); // It is now also headersPlus

            res.headers.set('Content-Range', 'bytes 0-100/1000');
            const range = res.headers.get('Content-Range', true);
            expect(range).to.deep.equal(['0-100', '1000']);
        });

        it('should create instances via .from()', function () {
            const req = RequestPlus.from('http://example.com', { method: 'POST' });
            expect(req).to.be.instanceOf(RequestPlus);
            expect(req.method).to.equal('POST');

            const res = ResponsePlus.from('content', { status: 201 });
            expect(res).to.be.instanceOf(ResponsePlus);
            expect(res.status).to.equal(201);
        });

        it('should provide extended body parsing (json)', async function () {
            const data = { foo: 'bar' };
            const res = new ResponsePlus(JSON.stringify(data), {
                headers: { 'Content-Type': 'application/json' }
            });

            const json = await res.json();
            expect(json).to.deep.equal(data);
        });

        it('should support .any() with memoization and conversions', async function () {
            const data = { foo: 'bar', prefs: [1, 2], loves_it: true };

            // 1. Auto-detect json
            const res1 = new ResponsePlus(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            const json = await res1.any();
            expect(json).to.deep.equal(data);

            // 2. Memoization (should return same object on subsequent calls)
            const res2 = new ResponsePlus(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            const j1 = await res2.any({ memo: true }); // Returns original, caches clone
            const j2 = await res2.any({ memo: true }); // Returns cached clone
            const j3 = await res2.any({ memo: true }); // Returns cached clone
            expect(j2).to.deep.equal(j1);
            expect(j3).to.deep.equal(j2); // Non-strict equality for cached hits

            // 3. Conversion JSON -> FormData
            // If we ask for formData from a JSON response
            const res3 = new ResponsePlus(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
            const fd = await res3.any({ to: 'formData' });
            // It should convert
            expect(await fd.json()).to.deep.equal(data);
        });

        it('should auto-generate headers in .from()', async function () {
            // 1. JSON
            const res1 = ResponsePlus.from({ a: 1 });
            // console.log('res1 headers:', [...res1.headers.entries()]);
            expect(res1.headers.get('Content-Type')).to.be.a('string').that.includes('application/json');
            expect(res1.headers.get('Content-Length')).to.exist;

            // 2. String
            const res2 = ResponsePlus.from('hello');
            expect(res2.headers.get('Content-Length')).to.equal('5');

            // 3. Binary (Uint8Array)
            const buffer = new TextEncoder().encode('hello');
            const res3 = ResponsePlus.from(buffer);
            expect(res3.headers.get('Content-Length')).to.equal('5');

            // 4. Blob
            const blob = new Blob(['hello'], { type: 'text/plain' });
            const res4 = ResponsePlus.from(blob);
            expect(res4.headers.get('Content-Type')).to.equal('text/plain');
            expect(res4.headers.get('Content-Length')).to.equal('5');
        });

        it('should auto-generate headers for specialized inputs in .from()', async function () {
            const url = 'http://url';

            // FormData
            const req1 = RequestPlus.from(url, { body: new FormData(), method: 'POST' });
            // Auto Content-Type: `multipart/form-data`
            expect(req1.headers.get('Content-Type')).to.be.a('string').that.includes('multipart/form-data');
            expect(req1.headers.get('Content-Length')).to.not.exist;

            // JSON object with complex data types
            const body2 = {
                name: 'John Doe',
                avatars: {
                    primary: new Blob(['imageBytes1'], { type: 'image/png' }),
                    secondary: new Blob(['imageBytes2'], { type: 'image/png' }),
                },
                loves_it: true,
            };
            const req2 = RequestPlus.from(url, { body: body2, method: 'POST' });
            // Auto Content-Type: `multipart/form-data`
            expect(req2.headers.get('Content-Type')).to.be.a('string').that.includes('multipart/form-data');
            expect(req2.headers.get('Content-Length')).to.not.exist;

            // TypeArray
            const req3 = RequestPlus.from(url, { body: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), method: 'POST' });
            // Auto Content-Type: `application/octet-stream`
            // Auto Content-Length: <number>
            expect(req3.headers.get('Content-Type')).to.be.a('string').that.includes('application/octet-stream');
            expect(req3.headers.get('Content-Length')).to.exist;

            // Blob
            const req4 = RequestPlus.from(url, { body: new Blob(['hello'], { type: 'text/plain' }), method: 'POST' });
            // Auto Content-Type: `text/plain`
            // Auto Content-Length: <number>
            expect(req4.headers.get('Content-Type')).to.be.a('string').that.includes('text/plain');
            expect(req4.headers.get('Content-Length')).to.exist;
        });
    });

    describe('FormDataPlus', function () {
        it('should convert FormData to JSON', async function () {
            const fd = new FormDataPlus();
            fd.append('name', 'Alice');
            fd.append('age', '30');
            fd.append('skills[0]', 'JS');
            fd.append('skills[]', 'Testing');

            const json = await fd.json();
            expect(json).to.deep.equal({
                name: 'Alice',
                age: 30,
                skills: ['JS', 'Testing']
            });
        });

        // Nested structure if supported?
        it('should support nested structures in FormData keys', async function () {
            const fd = new FormDataPlus();
            fd.append('user[name]', 'Bob');
            fd.append('user[address][city]', 'New York');

            const json = await fd.json();
            expect(json).to.deep.equal({
                user: {
                    name: 'Bob',
                    address: {
                        city: 'New York'
                    }
                }
            });
        });
    });

    describe('fetchPlus', function () {
        it('should return a ResponsePlus', async function () {
            // Mock global fetch
            const originalFetch = globalThis.fetch;
            globalThis.fetch = async () => new Response('ok');

            const res = await fetchPlus('http://mock.url');
            // Check if it has extended capabilities, e.g. upgraded headers
            res.headers.set('Range', 'bytes=0-10');
            expect(res.headers.get('Range', true)).to.be.an('array');

            globalThis.fetch = originalFetch;
        });
    });

});
