# Fetch+ – _The LiveResponse API & Advanced Fetch for the Modern Web_

[![npm version][npm-version-src]][npm-version-href]
[![bundle][bundle-src]][bundle-href]
[![License][license-src]][npm-version-href]

Fetch+ extends the web’s request/response model and its core primitives to support more ambitious application development.
Fetch+ introduces:

1. **A LiveResponse API** – a new response primitive that makes realtime communication native to the existing request/response model.
2. **Design extensions to the Fetch API** – a set of additions to `fetch`, `Request`, `Response`, `Headers`, and `FormData` that addresses the unintuitive parts of the API.

These represent two distinct capability families but one coherent upgrade to the transport layer and its interfaces.

This README is divided accordingly into two sections:

1. [`LiveResponse`](#section-1-liveresponse)
2. [Fetch API Extensions](#section-2-fetch-api-extensions)

> [!NOTE]
>
> The documentation is expansive by design.
> The code doing the work is not — Fetch+ weighs < `7 KiB min | gzip`.

---

## Install

```bash
npm i @webqit/fetch-plus
```

```js
import { LiveResponse, RequestPlus, ResponsePlus, HeadersPlus, FormDataPlus, fetchPlus, Observer } from '@webqit/fetch-plus';
```

## CDN Include

```html
<script src="https://unpkg.com/@webqit/fetch-plus/dist/main.js"></script>

<script>
    const { LiveResponse, RequestPlus, ResponsePlus, HeadersPlus, FormDataPlus, fetchPlus, Observer } = window.webqit;
</script>
```

---

## _Section 1_: `LiveResponse`

Applications increasingly need to work in real time across network boundaries. Traditionally, this has required a split architecture:

+ an initial HTTP request/response path, paired with
+ a separate, long-lived update path, typically backed by web sockets

coordinated at the application level.

Fetch+ removes the need for this split by extending the request/response model with "live" responses. LiveResponse allows application state, transitions, and messaging to be expressed as properties of the existing request/response model.

A `LiveResponse` is a "live" representation of application-level data – an object, an array, a string, a number, etc. – that crosses the wire *by reference*.

```js
// On the server
const state = { count: 0 };
const response = new LiveResponse(state);
return response;
```

The client gains the response as a reference to the original server-side instance.

```js
// On the client
const response = new LiveResponse(await fetch('http://localhost/counter'));
const state = (await response.now()).body;
console.log(state); // { count: 0 }
```

What makes this "live response" is the live relationship and interactivity between the client-side instance and the server-side instance.

LiveResponse works in real-time in three ways:

1. Supports live state projection via mutable response bodies.
2. Offers a multi-response architecture via response swaps.
3. Supports bidirectional messaging via message ports.

### 1. Live State Projection via Mutable Response Bodies

Being a live reference across the wire, when the body of a `LiveResponse` is a mutable value, mutations applied on the server are reflected on the client.

```js
// On the server
Observer.set(state, 'count', value);

// On the client
console.log(state.count); // value
```

Concretely, this looks like this:

**On the server:**

```js
const state = { count: 0 };
const response = new LiveResponse(state);

setInterval(() => {
    Observer.set(state, 'count', state.count + 1);
}, 1000);

return response;
```

**On the client:**

```js
const response = new LiveResponse(await fetch('http://localhost/counter'));
const state = (await response.now()).body;

Observer.observe(state, () => {
    console.log(state.count);
});
```

### 2. A Multi-Response Architecture via Response Swaps

Over the same instance, a live response may model multiple responses across time. They're designed to be replaced in-place.

Replacements are entire response swaps — status, headers, and body — to a new response.

```js
// On the server
res.replaceWith(newState, { status, statusText, headers, done });

// On the client
console.log(response.body); // newState
state = response.body;
```

Concretely, this looks like this:

**On the server:**

```js
const response = new LiveResponse({ pageTitle: 'Hello World' }, { done: false });

setTimeout(() => {
    response.replaceWith({ pageTitle: 'Hello again World' }, { done: false });
}, 2000);

setTimeout(() => {
    response.replaceWith(null, { status: 302, headers: { Location: '/' }, done: true });
}, 4000);

return response;
```

**On the client:**

```js
const response = new LiveResponse(await fetch('http://localhost/hello'));
console.log((await response.now()).body); // { pageTitle: 'Hello World' }

response.addEventListener('replace', () => {
    if (response.headers.get('Location')) {
        handleRedirect(response.headers.get('Location'));
        return;
    }
    console.log(response.body); // { pageTitle: 'Hello again World' }
    state = response.body;
});
```

### 3. Bidirectional Messaging via Message Ports

Live responses are backed by real-time message ports that by themselves enable bidirectional messaging.
The server holds one end of the port, while the client – the client-side LiveResponse instance – holds the other.

```js
// On the server
request.port.postMessage('Hello from server');
request.port.addEventListener('message', (event) => {
    console.log(event.data); // Hello from client
});

// On the client
response.port.postMessage('Hello from client');
response.port.addEventListener('message', (event) => {
    console.log(event.data); // Hello from server
});
```

Concretely, this looks like this:

**On the server:**

```js
async function handle(request, signal, done) {
    // Assuming that the application runtime injects "request.port", "signal", and "done"
    // and manages the relevant lifecycles
    
    request.port.postMessage('Hello from server');
    request.port.addEventListener('message', (event) => {
        console.log(event.data); // Hello from client
    }, { signal });

    // ---- other logic ----

    const response = new LiveResponse({ pageTitle: 'Hello World' });

    setTimeout(() => {
        if (!signal.aborted) {
            response.replaceWith({ pageTitle: 'Hello again World' }, { done: false });
        }
        done();
    }, 5000);

    // Assuming that the application runtime accepts LiveResponse as return value
    // and maps it back to the output stream
    return response;
}
```

Note that `request.port` above is assumed to be injected by the application runtime. Its creation is shown soon in the Sample Express App area.

> [!TIP]
>
> Note the distinction between `request.port` – as used above – and `response.port`.
> While `request.port` refers to a port instantiated by the application runtime per request (which the client is expected to connect to),
> `response.port` is a port instantiated by `LiveResponse` per the response of that request. Think of it as:
> 
> ```js
> (client) response.port ◀────▶ request.port (server)
> ```

**On the client:**

```js
const response = new LiveResponse(await fetch('http://localhost/hello'));

response.port.postMessage('Hello from client');
response.port.addEventListener('message', (event) => {
    console.log(event.data); // Hello from server
});
```

### Backend Integration

`LiveResponse`-based backends are easy to build. This typically involves:

1. Creating the server-side port and exposing it – e.g. as `request.port`
2. Managing request + port lifecycles via an abort signal
3. Converting `LiveResponse` to a standard response
4. Adding the `X-Message-Port` header to the outgoing response

Depending on your use case:

+ See the sample Express.js integration below for a custom integration example.
+ See the [`@webqit/node-live-response`](https://github.com/webqit/node-live-response) package for a direct Node.js or Express.js integration.
+ See [Webflo](https://github.com/webqit/webflo) for a framework with a live-mode-first architecture.

#### Sample Express.js Integration

The following is a sample `LiveResponse` integration with Express.js.

As a high-level overview:

1. `/hello` is an interactive route that uses `LiveResponse` and `request.port`.
2. The core of the integration is in the `interactiveRoute` function below.
3. The web socket integration is provided by `express-ws`.
4. `StarPort` and `WebSocketPort` are `LiveResponse`-native port interfaces.

```js
// ----- the setup -----
import express from 'express';
import expressWs from 'express-ws';
import { StarPort, WebSocketPort } from '@webqit/port-plus';
import { LiveResponse } from '@webqit/fetch-plus';

const app = express();
expressWs(app);

app.listen(3000);
```

```js
// ----- route handling -----
app.get('/hello', (req, res) => {
    interactiveRoute(req, res, async (req, signal, done) => {
        // "request.port" is injected by now

        req.port.postMessage('Hello from server');
        req.port.addEventListener('message', (event) => {
            console.log(event.data); // Hello from client
        }, { signal });

        const response = new LiveResponse({ pageTitle: 'Hello World' });

        setTimeout(() => {
            if (!signal.aborted) {
                response.replaceWith({ pageTitle: 'Hello again World' }, { done: false });
            }
            done();
        }, 5000);

        // LiveResponse as return value
        return response;
    });    
});
```

```js
// ----- the integration -----
const portRegistry = new Map();
app.ws('/', function(ws, req) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (!url.searchParams.has('port_id')) {
        ws.close();
        return;
    }
    const portId = url.searchParams.get('port_id');
    const wsPort = new WebSocketPort(ws, { handshake: 1, postAwaitsOpen: true });
    // All connecting clients over portId go into the same star port
    portRegistry.get(portId).addPort(wsPort);
});

async function interactiveRoute(req, res, handle) {
    // --- before handle ---
    req.port = new StarPort({ handshake: 1, postAwaitsOpen: true, autoClose: true });
    const portId = crypto.randomUUID();
    portRegistry.set(portId, req.port);

    const abortController = new AbortController();
    const doneCallback = () => {
        abortController.abort();
        req.port.close();
        portRegistry.delete(portId);
    };
    // ---
    
    const response = await handle(req, abortController.signal, doneCallback);
    
    // --- after handle ---
    // Convert the response to a WHATWG response
    const outgoingRes = response.toResponse({ port: req.port, signal: abortController.signal });
    
    // Add the realtime port header – tells the client where to connect to.
    // On the client-side, LiveResponse detects the header and connects to the web socket URL.
    outgoingRes.headers.set('X-Message-Port', `socket:///?port_id=${portId}`);
    // MADE OF TWO PARTS:
    // 1. The port scheme "socket://" (as defined by LiveResponse)
    // 2. The connection URI "/?port_id=portId" (as defined by the server). You almost always want this part to begin with a slash.
    
    // Pipe the response to the nodejs response stream
    for (const [name, value] of outgoingRes.headers) {
        res.setHeader(name, value);
    }
    outgoingRes.body.pipeTo(res);
    // ---

    // LIFECYCLE TIP:
    // 1. At this point, the port remains interactive until handler calls our doneCallback above
    // 2. But we can also shortcut the process by calling doneCallback() above based on some condition
    //if (condition) {
    //    doneCallback();
    //}
}
```

### Implementation Guide

#### Ports & Channels

Live responses are backed by real-time message ports.
The server holds one end of the port, while the client – the client-side LiveResponse instance – holds the other.
LiveResponse communicates over the established channel.

Ports in LiveResponse are based on [Port+](https://github.com/webqit/port-plus). It makes it possible
for LiveResponse to work universally against the same port interface; multiple messaging primitives, same port interface:

+ WebSocket – via `WebSocketPort`
+ BroadcastChannel – via `BroadcastChannelPlus`
+ MessageChannel – via `MessageChannelPlus`

LiveResponse can therefore be used between:

+ Server ◀────▶ Client – backed by WebSocket
+ Service Worker ◀────▶ Main Thread – backed by BroadcastChannel
+ Main Thread ◀────▶ Main Thread – backed by BroadcastChannel or MessageChannel

##### Server ◀────▶ Client

The idea here is to create a port instance on the server for the given request
and "invite" the issuing client to connect to it. To achieve this, the port instance is
assigned a unique identifier. That identifier is sent in the invite.
This is done via the `X-Message-Port` header.

```js
import { StarPort, WebSocketPort } from '@webqit/port-plus';

// Create a port that will contain the ws instance
req.port = new StarPort();
const portId = crypto.randomUUID();
portRegistry.set(portId, req.port);
```

> [!TIP]
>
> `StarPort` is a "super" port that proxies other ports; more aptly, a "star topology" port.
> In this scenario, It lets us have a reference port instance even before the client connects over WebSocket.
> Messages sent ahead of that implicitly wait. The first connecting client sees them.

```js
// When the client connects...
const wsPort = new WebSocketPort(ws);
// use the port ID from the request URL
// to identify the original port it belongs. Add it
portRegistry.get(portId).addPort(wsPort);
```

```js
// Convert the LiveResponse to a standard Response
const outgoingRes = response.toResponse({ port: req.port, signal: abortController.signal });

// Attach the X-Message-Port header and send
outgoingRes.headers.set('X-Message-Port', `socket:///?port_id=${portId}`);
send(outgoingRes);
```

On the client, LiveResponse detects the presence of this header, and the port scheme, and connects via WebSocket.

```js
const serverResponse = await fetch('http://localhost/hello');
const response = new LiveResponse(serverResponse);
```

The resulting `response.port` interface on the client is `WebSocketPort`. It is the same interface as the rest, just backed by WebSocket.

##### Service Worker ◀────▶ Main Thread

The idea here is similar to the previous, but with a different port primitive, and a different port scheme.

```js
import { BroadcastChannelPlus } from '@webqit/port-plus';

// Create a Broadcast Channel that the client will connect to
// Mark it as the "server" port
const portId = crypto.randomUUID();
const req.port = new BroadcastChannelPlus(portId, {
    clientServerMode: 'server',
    postAwaitsOpen: true,
    handshake: 1 // Ensure it's ready to accept connections
});
```

```js
// Convert the LiveResponse to a standard Response
const outgoingRes = response.toResponse({ port: req.port, signal: abortController.signal });

// Attach the X-Message-Port header and send
outgoingRes.headers.set('X-Message-Port', `channel://${portId}`);
send(outgoingRes);
```

On the client, LiveResponse detects the presence of this header, and the port scheme, and connects via Broadcast Channel.

```js
const swResponse = await fetch('http://localhost/hello');
const response = new LiveResponse(swResponse);
```

The resulting `response.port` interface on the client is `BroadcastChannelPlus`. It is the same interface as the rest, but based on the `BroadcastChannel` API.

##### Main Thread ◀────▶ Main Thread

For Single Page Applications that handle navigations with a request/response model right in the browser UI,
it may be desired to support the LiveResponse model – and that is possible. Since there is no concept of the network layer, no encoding and decoding
between LiveResponse and standard Response is required; just direct passing of a LiveResponse instance.

The port model for this scenario is MessageChannel. The request handler creates an instance and holds on to `port1` or `port2`, and
directly injects the other into the LiveResponse instance:

```js
import { MessageChannelPlus } from '@webqit/port-plus';

async function handle(req) {
    // Create and assign the port
    const messageChannel = new MessageChannelPlus;
    req.port = messageChannel.port1;

    // ----- Handle the request -----
    const data = await getData();
    const response = new LiveResponse(data);

    // Inject the other port into LiveResponse
    LiveResponse.attachPort(response, messageChannel.port2);
    return response;
}
```

Both `port1` and `port2` in this scenario are `MessagePortPlus` interfaces. They are, again, the same interface as the rest, but based on the `MessageChannel` API.

##### The `X-Message-Port` Header

The `X-Message-Port` header has a specific format that is made of two parts:

1. The port scheme – as defined by LiveResponse. This is strictly either `"socket://"` (for WebSocket-backed ports),  or `"channel://"` (for BroadcastChannel-backed ports).
2. The connection URI or channel name – as defined by the application. This must be unique to the request being processed. This may look like `/?port_id=<portId>` (for a WebSocket connection URI; and you almost always want this part to begin with a slash), or `<channelName>` (for a BroadcastChannel).

Together, that typically looks like: `"socket:///?port_id=smkdnjdnjd67734n"` | `"channel://smkdnjdnjd67734n"`.

#### Mutations

Mutability is a foundational concept in LiveResponse. It gives the mental model of a stable object reference across time, with the potential
to change. This concept of "state" (stable identity) and "mutability" ("change" as a property of state) is what LiveResponse unifies across the network boundary, or process boundary.
With LiveResponse, "state" on the server (or in a certain JavaScript process) can be projected (as [above](#1-live-state-projection-via-mutable-response-bodies)) to the client (or another JavaScript process) for a shared identity and continuity.

For mutation-based reactivity, LiveResponse is backed by the [Observer](https://github.com/webqit/observer) API. When an object or array is passed as response body, subsequent mutations made to it via the Observer API are observed by LiveResponse and projected
to the client-side LiveResponse instance.

**On the server:**

```js
const state = { count: 0 };
const response = new LiveResponse(state);

setInterval(() => {
    Observer.set(state, 'count', state.count + 1);
}, 1000);

return response;
```

**On the client:**

```js
const response = new LiveResponse(await fetch('http://localhost/counter'));
const state = (await response.now()).body;

Observer.observe(state, () => {
    console.log(state.count); // number
});
```

Identity is stable universally, continuity is achieved, and reactive model is shared.

Beyond being used to make or observe mutations at the object level, Observer can also be used to observe the response instance
itself for body-replace events.

```js
Observer.observe(response, 'body', (m) => {
    console.log(m.oldValue); // null
    console.log(m.value); // { a: 1 }
});
```

```js
response.replaceWith({ a: 1 });
```

By comparison, LiveResponse's `"replace"` event fires for the same operation, but emits the fully-resolved response frame in the event:

```js
response.addEventListener('replace', (e) => {
    console.log(e.data); // { body: { a: 1 }, status: 200, statusText: '', ... }
});
```

Another distinction between the two methods is that Observer can observe depth:

```js
Observer.observe(response, Observer.path('body', 'a', 'b'), (m) => {
    console.log(m.value); // 22
});
```

```js
response.replaceWith({ a: { b: 22 } });
```

Of the two, the best approach will depend on use case.

### API Overview

`LiveResponse` has an API surface that describes a standard Response object but presents a state-based consumption model
rather than a stream-based consumption model. It supports the complete set of attributes that defines a response, and exposes
additional set of APIs for the state model.

#### 1. The standard set of attributes (shared by Response and LiveResponse)

| API / Feature                      | LiveResponse          | Standard Response            |
| :--------------------------------- | :-------------------- | :--------------------------- |
| `body`                             |     ✓ (`any`)         |         ✓ (`ReadableStream`) |
| `bodyUsed`                         |     ✓ (`boolean`)     |         ✓ (`boolean`)        |
| `headers`                          |     ✓ (`Headers`)     |         ✓ (`Headers`)        |
| `status`                           |     ✓ (`number`)      |         ✓ (`number`)     |
| `statusText`                       |     ✓ (`string`)      |         ✓ (`string`)     |
| `type`                             |     ✓ (`string`)      |         ✓ (`string`)     |
| `redirected`                       |     ✓ (`boolean`)     |         ✓ (`boolean`)    |
| `url`                              |     ✓ (`string`)      |         ✓ (`string`)     |
| `ok`                               |     ✓ (`boolean`)     |         ✓ (`boolean`)    |

**Notes:**

+ `body` is the direct value of the response instance, as against a `ReadableStream`. For example, `body` is `"Hello World"` for both `new LiveResponse("Hello World")` and  `new LiveResponse(new Response("Hello World"))`.
+ `bodyUsed` is always `true`, as LiveResponse has no concept of the stream originally described by this attribute. `bodyUsed` is provided for compatibility with Response.
+ Other attributes are a direct mapping to the corresponding attribute in the given input. For example, `statusText` is `"OK"` for an input like `new LiveResponse("Hello World", { statusText: "OK" })` and  `new LiveResponse(new Response("Hello World", { statusText: "OK" }))`.

#### 2. The non-applicable stream-based consumption APIs (_not applicable_ to LiveResponse)

| API / Feature                      | LiveResponse        | Standard Response                  |
| :--------------------------------- | :------------------ | :--------------------------------- |
| `formData()`                       |     ✗               |         ✓ (`Promise<FormData>`)    |
| `json()`                           |     ✗               |         ✓ (`Promise<object>`)      |
| `text()`                           |     ✗               |         ✓ (`Promise<string>`)      |
| `blob()`                           |     ✗               |         ✓ (`Promise<Blob>`)        |
| `arrayBuffer()`                    |     ✗               |         ✓ (`Promise<ArrayBuffer>`) |
| `bytes()`                          |     ✗               |         ✓ (`Promise<Uint8Array>`)  |

**Notes:**

+ These methods are _not applicable_ to LiveResponse – and thus, not implemented – as it has no concept of a stream, against which these operate.
+ Where desired, LiveResponse offers a `.toResponse()` method that lets you encode the LiveResponse instance back into a standard Response object.

#### 3. The state-based consumption APIs (only applicable to LiveResponse)

| API / Feature                      | LiveResponse                    | Standard Response      |
| :--------------------------------- | :------------------------------ | :--------------------- |
| `addEventListener()`               |     ✓                           |         ✗              |
| `removeEventListener()`            |     ✓                           |         ✗              |
| `.replaceWith()`                   |     ✓ (`Promise<any>`)          |         ✗              |
| `.now()`                           |     ✓ (`Promise<ResponseFrame>`) |         ✗              |

**Notes:**

+ `addEventListener()` and `removeEventListener()` lets you listen/unlisten to LiveResponse's `"replace"` events.
+ `.now()` lets you snapshot the state of the instance at the time of call. (Covered [just ahead](#now).)

#### 4. Other aspects of the LiveResponse interface

The remaining part of the LiveResponse interface includes lifecycle-specific
APIs like `readyState`, `readyStateChange()`, and `disconnect()`.

#### 5. Input Signature

LiveResponse implements the same input signature in both its constructor and its `.replaceWith()` method.
How you use the one is how you use the other.

```js
// Constructor
const response = new LiveResponse('Hello World', { headers: { 'Content-Type': 'text/plain' } });

// .replaceWith()
response.replaceWith('Hello Again World', { headers: { 'Content-Type': 'text/plain' } });
```

As in the standard Response API, the first argument is the response `body` and the second is the `responseInit` object.

##### `body`

LiveResponse accepts any JavaScript value as `body`, as long as it has a use case in the application. Strings, numbers, objects, arrays, etc. all work as body types.
For LiveResponses that cross the wire, body type is implicitly constrained by convertibility to a standard Response body. This is covered in the [encoding](#encoding-back-to-a-standard-response) section.

In addition to accepting arbitrary JavaScript values, LiveResponse also accepts:

+ existing "response" instances – both a standard Response object and a LiveResponse
instance itself – for cloning or merging. This is covered in the [decoding](#decoding-an-existing-response) section.
+ `Generator` objects and `LiveProgramHandle` objects – as input streams. This is covered in the [decoding](#decoding-generators) section.

##### `responseInit`

The `responseInit` object is a superset of the standard _ResponseInit_ object – accepting:

+ `headers`
+ `status`
+ `statusText`

but also other attributes that make it possible to model fetch-generated responses:

+ `type`
+ `redirected`
+ `url`

LiveResponse additionally accepts _lifecycle control_ parameters here:

+ `done`
+ `concurrent`

### Decoding an Existing Response

An existing response instance can be passed to LiveResponse for decoding or merging into the LiveResponse instance.
Both a standard Response object and a LiveResponse instance itself are supported:

```js
// Clone a standard response instance
const response1 = new LiveResponse(new Response('Hello from server'));
console.log((await response.now()).body); // 'Hello from server'

// Clone a LiveResponse instance
const response2 = new LiveResponse(response1);
console.log((await response.now()).body); // 'Hello from server'

// Flatten-in a standard response instance
await response2.replaceWith(new Response('Hello again from server'));
console.log(response2.body); // 'Hello again from server'

// Flatten-in a LiveResponse instance
await response2.replaceWith(new LiveResponse('Hello finally from server'));
console.log(response2.body); // 'Hello finally from server'
```

When passed a standard Response object, LiveResponse does a direct instance mapping of the given response. For the body, it automatically reads the body stream of the response and takes the result.

> [!TIP]
>
> The reading algorithm is:
>
> + Try to decode the data as JSON. (This succeeds for `Content-Type: application/json | multipart/form-data | application/x-www-form-urlencoded`. LiveResponse internally uses `ResponsePlus.prototype.any.call(response, { to: 'json' })` for this. This API is covered [below](#the-any-instance-method).)
> + If that fails, try to decode the data to the most appropriate result type for the given content type; e.g. "text" for `Content-Type: text/*`; `Blob` for `Content-Type: image/*`; etc. (LiveResponse internally uses `ResponsePlus.prototype.any.call(response)` for this. This API is covered [below](#the-any-instance-method).)
> + Map the result to the `body` attribute.

On success, LiveResponse inspects the response headers for the presence of the `X-Message-Port` header. If present, LiveResponse
automatically connects to the port specified by the header and begins a real time mirroring of the original response. The completion of this cycle is covered in the [Response-Frame Cycle](#2-the-response-frame-cycle) section.

When passed a LiveResponse instance itself, LiveResponse does a direct instance mapping of the given response. Next, LiveResponse automatically binds to the instance's change events and begins a real time mirroring of the response. The completion of this cycle is also covered in the [Response-Frame Cycle](#2-the-response-frame-cycle) section.

### Decoding Generators

LiveResponse's transitions can be directly driven by a JavaScript `Generator` or a [`LiveProgramHandle`](https://github.com/webqit/use-live) object.

When passed a `Generator` instance, LiveResponse consumes the stream asynchronously and maps each yielded value to a response frame:

```js
const response = LiveResponse(
    (async function*() {
        const frame1 = new Promise((resolve) => setTimeout(() => resolve('frame 1'), 100));
        yield frame1;
        // 100ms later
        yield 'frame 2';
        // Immediately after
        const frame3 = new Promise((resolve) => setTimeout(() => resolve('frame 3'), 100));
        return frame3;
    })()
);
setTimeout(() => console.log(response.body), 300); // 'frame 3'
```

When passed a `LiveProgramHandle` object, LiveResponse observes the Handle's `value` property and maps each emmission to a response frame:

```js
const response = LiveResponse(
    (function() {
        "use live";

        let count = 0;
        setInterval(() => count++, 1000);

        return count;
    })()
);
setTimeout(() => console.log(response.body), 2000); // 2
```

> [!IMPORTANT]
>
> Support for `LiveProgramHandle` objects is experimental and may change.

In both cases, the resulting value in each yield goes to the `body` of the resulting response frame.
If the said resulting value is a response instance itself, it flattens directly into the LiveResponse instance as described
in the [decoding](#decoding-an-existing-response) section:

```js
const response = LiveResponse(
    (async function*() {
        const frame1 = new Response('frame 1', { status: 201 });
        yield frame1;
        // 100ms later
        yield 'frame 2';
        // Immediately after
        const frame3 = new Response('frame 1', { headers: { 'Content-Type': 'text/custom' } });
        return frame3;
    })()
);
setTimeout(() => console.log(response.headers.get('Content-Type')), 300); // 'text/custom'
```

The completion of this cycle is covered in the [Response-Frame Cycle](#2-the-response-frame-cycle) section.

### Encoding Back to a Standard Response

The `.toResponse()` method can be used to encode a LiveResponse instance into a standard Response instance.
The encoding includes formatting the `body` value to the corresponding body type accepted by the Response API – where needed.
LiveResponse internally uses the [`ResponsePlus.from()`](#the-from-static-method) method for this.

Strings, for example, are native Response body types and are, therefore, passed untransformed to the standard Response constructor:

```js
const response = new LiveResponse('Hello world');
const whatwgResponse = response.toResponse();

console.log(await whatwgResponse.text()); // 'Hello world'
```

For unusual value types, like functions, Symbols, etc., that may make it to a LiveResponse instance as body,
the success of the transition from a LiveResponse to a standard Response instance will depend on whether the given value type is accepted by the Response API or,
at least, handled in the `ResponsePlus.from()` algorithm. For example, while "function" types aren't handled in the algorithm, they
naturally get serialized as strings by the Response API itself:

```js
// Functions serialize well as strings. Symbols fail
console.log(await new LiveResponse(() => 3).toResponse().text()); // '() => 3'
```

Structured value types like objects and arrays are handled in the `ResponsePlus.from()` algorithm. They are formatted as JSON strings – along with the relevant headers. But when they contain
special object types like Blobs, the algorithm smartly encodes them as "multipart/formdata" payloads instead:

```js
const body1 = { a: 1, b: 2 };
// Plain JSON payload
console.log(await new LiveResponse(body1).toResponse().headers.get('Content-Type')); // 'application/json'
```

```js
const body1 = { a: 1, b: new Blob([bytes]) };
// Multipart/FormData payload
console.log(await new LiveResponse(body1).toResponse().headers.get('Content-Type')); // 'multipart/formdata;...'
```

The return value of the `.toResponse()` method is a standard Response instance – more specifically, a [`ResponsePlus`](#request-and-response-interfaces-with-sensible-defaults---requestplus-and-responseplus) instance.

### Lifecycles

#### 1. The Ready-State Cycle

A LiveResponse instance transitions through three states in its lifetime:

-  **`waiting`**: The initial frame is still resolving
-  **`live`**: The initial frame has resolved and is effective on the instance
-  **`done`**: Final frame has resolved and is effective on the instance, no more "replace" operations expected

For _synchronously-resolvable_ inputs like strings and objects, the instance transitions to `live` synchronously:

```js
const response = new LiveResponse('Initial frame');
console.log(response.readyState); // "live"
```

It transitions to "done" at `Promise.resolve()` timing:

```js
Promise.resolve().then(() => console.log(response.readyState)); // "done"
// Or simply:
// await Promise.resolve();
// console.log(response.readyState); // "done"
```

For _asynchronously-resolved_ inputs like promise-wrapped values and Response instances, the instance transitions to `live` at the resolution timing of the input:

```js
const response = new LiveResponse(Promise.resolve('Initial frame'));
console.log(response.readyState); // "waiting"

Promise.resolve().then(() => console.log(response.readyState)); // "live"
// Or simply:
// await Promise.resolve();
// console.log(response.readyState); // "live"
```

It transitions to "done" at 2 x `Promise.resolve()` timing:

```js
Promise.resolve().then(() => Promise.resolve().then(() => console.log(response.readyState))); // "done"
// Or simply:
// await Promise.resolve();
// await Promise.resolve();
// console.log(response.readyState); // "done"
```

The `.readyStateChange()` method can be used to await ready-state transitions. This method returns a Promise (the same instance each time) that resolves to the LiveResponse instance itself when the ready state transitions to the specified state:

```js
await response.readyStateChange('live'); // Resolves when ready-state transitions to "live"
await response.readyStateChange('done'); // Resolves when ready-state transitions to "done"
```

The ready-state completion of the instance can be controlled via the `responseInit.done` parameter. When `false`, the response is kept open to further replacements – via `.replaceWith()`.
When `true`, the instance is treated as finalized at the _end_ of the current frame's cycle. The instance's ready state transitions to `done` and no further replacement is permitted. When omitted, `done: true` is implied.

```js
const response = new LiveResponse('Initial frame', { done: false }); // Remains open
console.log(response.readyState); // "live"

response.replaceWith('Intermediate frame', { done: false }); // Remains open
console.log(response.readyState); // "live"

response.replaceWith('Final frame'); // Transitions to "done" at Promise.resolve() timing

await Promise.resolve();
console.log(response.readyState); // "done"
```

The ready-state's transition to "done" happens _at the end_ of the active frame's cycle – obvious for async inputs:

```js
const response = new LiveResponse('Initial frame', { done: false }); // Remains open
console.log(response.readyState); // "live"

const finalFrame = new Promise((r) => setTimeout(() => r('Final frame'), 100));
response.replaceWith(finalFrame); // Transitions to "done" AFTER promise resolves in 100ms

await Promise.resolve();
console.log(response.readyState); // "live"

await new Promise((r) => setTimeout(r, 100));
console.log(response.readyState); // "done"
```

If a new "replace" operation is made before the ready-state's transition to "done", the incoming frame takes over the ready-state:

```js
const response = new LiveResponse('Initial frame', { done: false }); // Remains open
console.log(response.readyState); // "live"

const finalFrame = new Promise((r) => setTimeout(() => r('Final frame'), 100));
response.replaceWith(finalFrame); // Transitions to "done" AFTER promise resolves in 100ms

await Promise.resolve();
console.log(response.readyState); // "live"

response.replaceWith('Final final frame'); // Takes over the ready-state; transitions to "done" MUCH SOONER

await Promise.resolve();
console.log(response.readyState); // "done"
```

```js
const response = new LiveResponse('Initial frame', { done: false }); // Remains open
console.log(response.readyState); // "live"

response.replaceWith(Promise.resolve('Final frame')); // Transitions to "done" after promise resolves
console.log(response.readyState); // "live"

const finalFinalFrame = new Promise((r) => setTimeout(() => r('Final final frame'), 100));
response.replaceWith(finalFinalFrame); // Takes over the ready-state; transitions to "done" MUCH LATER – being an asynchronous input

await Promise.resolve();
console.log(response.readyState); // "live"

await new Promise((r) => setTimeout(r, 100));
console.log(response.readyState); // "done"
```

**Summary:**

+ At any point, `.readyState` answers "What state is the instance in now?" (`waiting` | `live` | `done`)
+ `.readyStateChange()` says "Give me a promise that resolves when the instance transitions to..."
+ `responseInit.done = false` says "Keep the instance alive for future replacements"
+ `.replaceWith()` takes over Ready State on each call; throws when called after instance reaches "done"

#### 2. The Response-Frame Cycle

"Response-Frame" refers to the _semantic response_ modelled by a LiveResponse instance at any point in time. The first semantic response
is defined by the arguments passed at instantiation, and a new semantic response is assumed on each replacement. That equates to, at least, two response frames.

```js
const response = new LiveResponse('Initial frame', { done: false }); // Frame 1
response.replaceWith('Another frame'); // Frame 2
```

For _synchronously-resolvable_ inputs like strings and objects, inputs reflect synchronously on the instance:

```js
const response = new LiveResponse('Hello World', { headers: { 'Content-Type': 'text/plain' } });

console.log(response.body); // "Hello World"
console.log(response.headers.get('Content-Type')); // "text/plain"

response.replaceWith('Hello again World', { headers: { 'Content-Type': 'foo/bar' } });

console.log(response.body); // "Hello again World"
console.log(response.headers.get('Content-Type')); // "foo/bar"
```

For _asynchronously-resolved_ inputs like promise-wrapped values and Response instances, inputs reflect on the instance at the resolution timing of the input:

```js
const response = new LiveResponse(Promise.resolve('Hello World'), { headers: { 'Content-Type': 'text/plain' } });

// Direct access sees nothing yet
console.log(response.body); // null
console.log(response.headers.get('Content-Type')); // null

Promise.resolve().then(() => {
    console.log(response.body); // "Hello World"
    console.log(response.headers.get('Content-Type')); // "text/plain"
});
// Or simply:
// await Promise.resolve();
// console.log(response.body); // "Hello World"
// console.log(response.headers.get('Content-Type')); // "text/plain"
```

The timing between when a frame is issued, reflected, and replaced is the Response-Frame Cycle.

The `.now()` method lets you snapshot the state of the instance at the time of call, regardless of the resolution phase of the most current frame.
This method returns a Promise that resolves to a `ResponseFrame` object – the fully resolved input "frame".

```js
const response = new LiveResponse(new Response('Hello World'), { headers: { 'Content-Type': 'text/plain' } });

// Direct access sees nothing yet
console.log(response.body); // null
console.log(response.headers.get('Content-Type')); // null

// .now() snapshots the resolving frame
console.log((await response.now()).body); // "Hello World"
console.log((await response.now()).headers.get('Content-Type')); // "text/plain"
```

As a general rule, `.now()` snapshots at _call time_ and resolves at _resolution time_.
This means `.now()` gives predictable results regardless of the resolution timing of the input.

In a sequence of "replace" operations, for example, a previous replacement, if asynchronous, may yet be resolving when the next comes, and if so, is abandoned for the next. `.now()` resolves predictably even on abandoned frames.

```js
const frame1 = new Promise((resolve) => setTimeout(() => resolve('frame 1'), 10));

const response = new LiveResponse(frame1, { done: false });
const snapshot1 = response.now(); // Snapshot 'frame 1' while still resolving

response.replaceWith('frame 2', { done: false }); // 'frame 1' is abandoned now while still resolving
const snapshot2 = response.now(); // Snapshot 'frame 2'

const frame3 = new Promise((resolve) => setTimeout(() => resolve('frame 3'), 10));
response.replaceWith(frame3, { done: false }); // 'frame 2' – which resolved synchronously – is replaced now
const snapshot3 = response.now(); // Snapshot 'frame 3' while still resolving

const frame4 = new Promise((resolve) => setTimeout(() => resolve('frame 4'), 10));
response.replaceWith(frame4, { done: true }); // 'frame 3' is abandoned now while still resolving
const snapshot4 = response.now(); // Snapshot 'frame 4' while still resolving

console.log((await snapshot1).body); // 'frame 1'
console.log((await snapshot2).body); // 'frame 2'
console.log((await snapshot3).body); // 'frame 3'
console.log((await snapshot4).body); // 'frame 4'
```

In all cases, too, `.replaceWith()` returns a Promise that resolves to `true` when the frame cycle completes.

```js
const frame5 = new Promise((resolve) => setTimeout(() => resolve('frame 5'), 10));
await response.replaceWith(frame5, { done: false });

console.log(response.body); // 'frame 5'
```

For multi-frame inputs like `Generators`, `.replaceWith()` resolves at the resolution timing of the last subframe.
This is when the frame cycle is considered complete from the perspective of the caller, making it easy to coordinate subsequent replacements.

For example, `replaceStatus5_7` below, resolves `200+ms` later:

```js
const replaceStatus5_7 = await response.replaceWith(
    (async function*() {
        const frame5 = new Promise((resolve) => setTimeout(() => resolve('frame 5'), 100));
        yield frame5;
        // 100ms later
        yield 'frame 6';
        // Immediately after
        const frame7 = new Promise((resolve) => setTimeout(() => resolve('frame 7'), 100));
        return frame7;
    })(),
    { done: false } // Keep the instance open even after frame 7
);
// About 200+ms later
console.log(replaceStatus5_7); // true

// We can replace now
const replaceStatus8 = await response.replaceWith('frame 8');
console.log(replaceStatus8); // true
```

`replaceStatus9` below, resolves when the series of responses from upstream – over the specified `X-Message-Port` – is complete, or when the port closes:

```js
const upstreamResponse = new Response('frame 9', { headers: { 'X-Message-Port': 'socket:///?port_id=fedkdkjd43' }});
const replaceStatus9 = await response.replaceWith(
    upstreamResponse,
    { done: false } // Keep the instance open even after cycle completes
);
// After cycle completes
console.log(replaceStatus9); // true

// We can replace now
const replaceStatus10 = await response.replaceWith('frame 10');
console.log(replaceStatus10); // true
```

`replaceStatus11` below, resolves when the specified LiveResponse input completes its lifecycle – that is, transitions to "done":

```js
const nestedLiveResponse = LiveResponse.from(fetch('http://localhost/hello'));
const replaceStatus11 = await response.replaceWith(
    nestedLiveResponse,
    { done: false } // Keep the instance open even after cycle completes
);
// After cycle completes
console.log(replaceStatus11); // true

// We can replace now
const replaceStatus12 = await response.replaceWith('frame 12');
console.log(replaceStatus12); // true
```

In all cases, however, the Promise returned by `.replaceWith()` resolves _sooner_ to `false` when a new `.replaceWith()` call is made, or `.disconnect()` is called, before the frame cycle completes:

```js
// Going live after 100ms...
const frame5 = new Promise((resolve) => setTimeout(() => resolve('frame 5'), 100));

const replacePromise5 = response.replaceWith(frame5, { done: false });
const snapshot5 = response.now();

replacePromise5.then((status) => console.log('Did we go live?', status));
snapshot5.then(() => console.log('We resolved at our 100ms timing tho'));

// Wait 50ms and blow out the yet resolving frame 5
await new Promise((resolve) => setTimeout(() => resolve('frame 5'), 50));
response.replaceWith('frame 6');

// After 50ms: 'Did we go live?' false
// After 100ms: 'We resolved at our 100ms timing tho'
```

**Summary:**

+ At any point, `.now()` helps ensure that you are accessing the instance with the most current frame already "live" on the instance.
  + It is also useful for "Give me a Promise that resolves when my last `.replaceWith()` call resolves" – whether it indeed goes live on the instance or not
+ The promise returned by `.replaceWith()` is also useful for "Give me a Promise that resolves when the given input resolves"
  + But it additionally answers "Did that successfully go live on the instance or was it abandoned for a newer `.replaceWith()` or `.disconnect()` call?"
+ While `.now()` and `.replaceWith()` may resolve equally at the resolution timing of certain inputs, they don't always – as they are designed to answer different questions.
  + For multi-frame inputs like `Generators`, `.replaceWith()` resolves at the resolution timing of the last frame. `.now()` resolves at that of the first
  + `.replaceWith()` may resolve sooner if superseded by another `.replaceWith()` call, or abandoned via `.disconnect()`, before completion

#### 3. The Live-State Projection Cycle

When LiveResponse [projects live state](#1-live-state-projection-via-mutable-response-bodies) across the wire, the state remains live until
the next `.replaceWith()` call – which establishes a new response frame and a new state. On the client, the replaced state
stops reflecting mutations made on the server. But it also can be kept alive concurrently with the new state. This is done by passing a `concurrent: true` flag
with the new "replace" operation:

```js
const initialState = { count: 0 };
const response = new LiveResponse(initialState);

// Counter
setInterval(() => {
    Observer.set(initialState, 'count', initialState.count + 1);
}, 1000);

// Later
setTimeout(() => {
    response.replaceWith('Hello Now', { concurrent: true });
    console.log(response.concurrent); // true
}, 10_000);

// Return response for sending over the network
return response;
```

With `concurrent: true`, the counter above will continue unstopped on the client side even when the response is replaced:

```js
const response = LiveResponse.from(fetch('http://localhost/counter'));
const initialState = (await response.now()).body;

Observer.observe(initialState, 'count', () => {
    console.log(initialState.count);
});

response.addEventListener('replace', () => {
    // 'Hello Now' has arrived and should specify "concurrent: true"
    console.log(response.body); // 'Hello Now'
    console.log(response.concurrent); // true
});
```

---

## _Section 2_: Fetch API Extensions

Fetch+ introduces a small set of in-place extensions to the core Fetch primitives—`Request`, `Response`, `Headers`, `FormData`, and `fetch()`—to provide a more semantic and developer-friendly API surface.

### Request and Response Interfaces with Sensible Defaults  – `RequestPlus` and `ResponsePlus`

`RequestPlus` and `ResponsePlus` are extensions of the `Request` and `Response` interfaces that add support for type-agnostic
body parsing and a factory method with sensible defaults. These methods are:

+ `RequestPlus.prototype.any()` / `ResponsePlus.prototype.any()`
+ `RequestPlus.from()` / `ResponsePlus.from()`
+ `RequestPlus.copy()`

#### The `.any()` Instance Method

**APIs**: `RequestPlus.prototype.any()` / `ResponsePlus.prototype.any()`

The `.any()` instance method is an addition to the existing list of request/response body readers – `.text()`, `.json()`, `.arrayBuffer()`, `.blob()`, `.formData()`, and `.bytes()`.
`.any()` works as a unified, content-type-aware body reader. By default, it auto-infers the body type from the instance's `Content-Type` header and dispatches to the appropriate reader – yielding:

+ result type `FormData` – for content-type `multipart/form-data` | `application/x-www-form-urlencoded`
+ result type JSON object – for content-type `application/json`
+ result type string – for content-type `text/*` | `application/javascript` | `application/*xml*`
+ result type `Blob` – for content-type `image/*` | `audio/*` | `video/*` | `application/*` (excluding: `application/*xml*` | `application/*json*` | `application/*javascript*` | `application/*x-www-form-urlencoded*`)
+ result type `Uint8Array` – for other content-types, e.g. `application/octet-stream`

with support for explicit type selection via an options parameter.

**Signature**:

+ `.any()`: `Promise<any>`
+ `.any({ to?, memo? })`: `Promise<any>`

**Options**:

+ `to`: `"arrayBuffer"` | `"blob"` | `"formData"` | `"json"` | `"text"` | `"bytes"`
+ `memo`: `boolean` Controls whether to memoize the result. When true, the result is cached and returned on subsequent calls.

**Example 1: _Auto type detection_**

Call `.any()` and get back a corresponding result type for the specific content type of the request or response.

```js
// For content-type `multipart/form-data` | `application/x-www-form-urlencoded`
const body = await response.any(); // FormData

// For content-type `application/json`
const body = await response.any(); // JSON object

// For content-type `text/*` | `application/javascript` | `application/*xml*`
const body = await response.any(); // text

// For content-type `image/*` | `audio/*` | `video/*` | `application/*` (excluding: `application/*xml*` | `application/*json*` | `application/*javascript*` | `application/*x-www-form-urlencoded*`)
const body = await response.any(); // Blob

// For other content-types, e.g. `application/octet-stream`
const body = await response.any(); // Uint8Array
```

**Example 2: _Explicit type selection/coercion_**

Explicitly pass a type to `.any()` at any time.

```js
// For content-type `application/json` | `application/x-www-form-urlencoded` | `multipart/form-data`
const body = await response.any({ to: 'json' }); // JSON object
const body = await response.any({ to: 'formData' }); // FormData

// For ALL Content-Types, including `application/json` | `application/x-www-form-urlencoded` | `multipart/form-data`
const body = await response.any({ to: 'text' }); // text
const body = await response.any({ to: 'arrayBuffer' }); // ArrayBuffer
const body = await response.any({ to: 'blob' }); // Blob
const body = await response.any({ to: 'bytes' }); // Uint8Array
```

**Notes:**

+ Type coercion to structured formats – `json` | `formData` – is supported for any of `application/json` | `application/x-www-form-urlencoded` | `multipart/form-data`. In other words, any of the these three payload types can be cast to `json` or `formData` interchangeably.
+ Type coercion to unstructured formats – `text` | `arrayBuffer` | `blob` | `bytes` – is supported for ALL content-types, including `application/json` | `application/x-www-form-urlencoded` | `multipart/form-data`.

**Example 3: _Memoization_**

Opt in to memoization to enable multiple instance reads.

```js
const body = await response.any({ memo: true }); // Actively parsed on first call and memoized for subsequent calls
const body = await response.any({ memo: true }); // Returns cached result
```
**Notes:**

+ With `memo: true`, an automatic clone of the instance is kept the first time instance is read to support future reads.
+ Results are also memoized – by type – the first time the specified type is processed.
+ For results of type `json` | `formData`, the result of each call is a _copy_ of the cached. For other types, the result of each call _is_ the cached.
+ Cache can be cleared at any time by calling `.forget()` on the instance. (A synchronous method.)

**Example 4: _Direct Instantiation_**

Use `RequestPlus` and `ResponsePlus` in code by directly instantiating them.

```js
import { RequestPlus, ResponsePlus } from 'fetch-plus';
```

```js
const jsonObject = {
    name: 'John Doe',
    email: 'john.doe@example.com'
};
```

```js
const request = new RequestPlus(url, {
    method: 'POST',
    body: JSON.stringify(jsonObject),
    headers: { 'Content-Type': 'application/json' }
});
const jsonObject = await request.any();
const jsonObject = await request.any({ to: 'json' });
const formData = await request.any({ to: 'formData' });
```

```js
const response = new ResponsePlus(JSON.stringify(jsonObject), {
    headers: { 'Content-Type': 'application/json' }
});
const jsonObject = await response.any();
const jsonObject = await response.any({ to: 'json' });
const formData = await response.any({ to: 'formData' });
```

`fetchPlus()` is also provided as a direct entry point to `ResponsePlus`. (`fetchPlus()` returns an instance of `ResponsePlus`.)

```js
// Using fetchPlus() for auto-upgraded response instances
import { fetchPlus } from 'fetch-plus';

const response = await fetchPlus(url); // Auto-upgraded response instance

const jsonObject = await response.any();
const jsonObject = await response.any({ to: 'json' });
const formData = await response.any({ to: 'formData' });
```

**Example 5: _Upgrade Paths for Existing Request/Response Instances_**

Cast existing request/response instance to `RequestPlus` or `ResponsePlus` using their respective `.upgradeInPlace()` static methods.

```js
// For existing request instances – in a service worker, for example
import { RequestPlus } from 'fetch-plus';

self.addEventListener('fetch', (event) => {
    const request = event.request;
    // Upgrade to RequestPlus
    RequestPlus.upgradeInPlace(request);

    event.respondWith((async () => {
        const body = await request.any({ to: 'json' });
        if (body.name === 'John Doe') {
            return new Response(JSON.stringify({ message: 'Hello, John Doe!' }));
        }
        return new Response(JSON.stringify({ message: 'Hello, World!' }));
    })());
});
```

```js
// For existing response instances – in a service worker, for example
import { ResponsePlus } from 'fetch-plus';

self.addEventListener('fetch', (event) => {
    const request = event.request;

    event.respondWith((async () => {
        const response = await fetch(request);
        // Upgrade to ResponsePlus
        ResponsePlus.upgradeInPlace(response);

        const body = await response.any({ to: 'json' });
        if (body.name === 'John Doe') {
            return new Response(JSON.stringify({ message: 'Hello, John Doe!' }));
        }
        return new Response(JSON.stringify({ message: 'Hello, World!' }));
    })());
});
```

#### The `.from()` Static Method

**APIs**: `RequestPlus.from()` / `ResponsePlus.from()`

The `.from()` static method is a factory method for creating new Request/Response instances directly from application data – JSON objects, strings, etc. – without the strict formatting requirement of the `Request`/`Response` constructors.
`.from()` automatically converts the given input to the required payload format and auto-adds the corresponding `Content-Type` header (and the `Content-Length` header, where possible) – yielding:

+ body type `FormData` with content-type `"multipart/form-data"` – for `FormData` inputs and JSON object inputs containing complex data types like `Blobs`
+ body type JSON string with content-type `"application/json"` – and the appropriate content-length value – for plain JSON object inputs
+ body type `Blob` with content-type `blob.type` – and content-length `blob.size` – for `Blob` inputs
+ body type `Uint8Array` | `Uint16Array` | `Uint32Array` | `ArrayBuffer` with content-type `"application/octet-stream"` – and content-length `"array.byteLength"` – for `TypedArray` inputs
+ other body types with content-type `"application/octet-stream"` – and the corresponding content-length value – for other inputs

**Signature**:

+ `RequestPlus.from(url, requestInit)`: `RequestPlus`
+ `ResponsePlus.from(data, responseInit)`: `ResponsePlus`

**Options**:

+ `init.memo`: `boolean` Controls whether to memoize the given input for direct retrieval on future `.any()` calls. When true, the input is cached and returned on calls to `.any()` – skipping the more expensive body traversal route.

**Example 1: _Auto input formatting_**

Create Request/Response instances directly from application data.

```js
// FormData
const request = RequestPlus.from(url, { body: new FormData() });
// Auto Content-Type: `multipart/form-data`

// JSON object with complex data types
const request = RequestPlus.from(url, { body: {
    name: 'John Doe',
    avatars: {
        primary: new Blob([imageBytes1], { type: 'image/png' }),
        secondary: new Blob([imageBytes2], { type: 'image/png' }),
    },
    loves_it: true,
} });
// Auto Content-Type: `multipart/form-data`

// Plain JSON object
const request = RequestPlus.from(url, { body: { name: 'John Doe', email: 'john.doe@example.com' } });
// Auto Content-Type: `application/json`
// Auto Content-Length: <number>

// string
const request = RequestPlus.from(url, { body: 'Hello, World!' });
// Auto Content-Type: `text/plain`
// Auto Content-Length: <number>

// TypeArray
const request = RequestPlus.from(url, { body: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) });
// Auto Content-Type: `application/octet-stream`
// Auto Content-Length: <number>

// Blob
const request = RequestPlus.from(url, { body: new Blob(['hello'], { type: 'text/plain' }) });
// Auto Content-Type: `text/plain`
// Auto Content-Length: <number>
```

**Example 2: _Memoization_**

Opt in to memoization for given input to enable multiple instance reads from the start.

```js
// FormData
const request = RequestPlus.from(url, { body: new FormData(), memo: true });
await request.any({ memo: true });
// Copy of original formData

// JSON object
const request = RequestPlus.from(url, { body: { name: 'John Doe', email: 'john.doe@example.com' }, memo: true });
await request.any({ memo: true });
// Copy of original JSON object

// JSON object
const request = RequestPlus.from(url, { body: { name: 'John Doe', email: 'john.doe@example.com' }, memo: true });
await request.any({ to: 'bytes', memo: true });
// Bytes from body-read initially – bytes from cache on subsequent .any({ to: 'bytes', memo: true }) calls
```

#### The `.copy()` Static Method

**APIs**: `RequestPlus.copy()`

The `.copy()` static method is a convenience method for copying request instance properties as plain JSON object. This is useful for creating full or partial look-alike request instances – which the `.clone()` method doesn't directly reflect.
`.copy()` takes an existing request instance and returns its properties:

```js
const requestInit = await RequestPlus.copy(request);
// {
//   url,
//   method,
//   body,
//   headers,
//   mode,
//   credentials,
//   cache,
//   redirect,
//   referrer,
//   integrity
// }
```

It also accepts an optional `overrides` object that provides overrides for specific properties:

```js
const requestInit = await RequestPlus.copy(request, { method: 'POST' });
```

The following transformation is applied:

+ The `body` attribute is `null` for `method` = `GET` | `HEAD`.
+ For `body` overrides (via `overrides.body`), any `Content-Type` and `Content-Length` headers from the base instance are not inherited.
+ `mode: "navigate"` is automatically rewritten to `mode: "cors"`.

**Signature**:

+ `.copy(request, overrides?)`: `Promise<object>`

**Example 1: _Create partial look-alike requests_**

Create a request instance from an existing instance with specific overrides.

```js
const request1 = new Request(url, {
    method: 'POST',
    body: JSON.stringify(jsonObject),
    headers: { 'Content-Type': 'application/json' }
});
```

```js
const { url, ...requestInit } = await RequestPlus.copy(request1, { method: 'GET' });
const request2 = new Request(url, requestInit);

console.log(request2.method); // GET
console.log(request2.body); // null
```

### Structured HTTP Headers – `HeadersPlus`

`HeadersPlus` is an extension of the `Headers` interface that adds support for structured input and output values on common HTTP headers:

+ The `Cookie` Request Header
+ The `Set-Cookie` Response Header
+ The `Range` Request Header
+ The `Content-Range` Response Header
+ The `Accept` Request Header

`HeadersPlus` is the _Headers_ interface exposed by `RequestPlus` and `ResponsePlus`:

```js
const request = new RequestPlus();
console.log(request.headers); // HeadersPlus
```

It can also be directly instantiated:

```js
import { HeadersPlus } from 'fetch-plus';

const headers = new HeadersPlus({ 'Content-Type': 'text/plain' });
headers.set('Content-Type', 'text/html');
```

#### The `Cookie` Request Header

**Structured output**: Get the `Cookie` header as a structured array of objects.

```js
// Syntax
const cookies = headers.get('Cookie', true);
```

```js
// Example
const cookies = headers.get('Cookie', true);
// [
//   { name: 'session', value: 'abc123' },
//   { name: 'theme', value: 'dark' },
//   { name: 'lang', value: 'en-US' }
// ]
```

**The default**: Get as raw strings.

```js
const cookies = headers.get('Cookie');
// 'session=abc123; theme=dark; lang=en-US'
```

**Structured input**: Set the `Cookie` header from a structured object or array of objects.

```js
// Syntax
const cookie = { name, value };

headers.set('Cookie', cookie);
headers.set('Cookie', [cookie, ...]);
```

```js
// Example
headers.set('Cookie', { name: 'session', value: 'xyz789' });
// Serializes to:
// 'session=xyz789'
```

**The default**: Set as raw strings.

```js
headers.set('Cookie', 'session=xyz789');
```

#### The `Set-Cookie` Response Header

**Structured output**: Get the `Set-Cookie` header as a structured array of objects.

```js
// Syntax
const cookies = headers.get('Set-Cookie', true);
```

```js
// Example
const cookies = headers.get('Set-Cookie', true);
// [
//   { name: 'session', value: 'xyz789', secure: true, path: '/' },
//   { name: 'prefs', value: 'dark_mode', maxAge: 3600 }
// ]
```

**The default**: Get as raw strings.

```js
const cookies = headers.get('Set-Cookie');
// 'session=xyz789; Secure; Path=/'

const cookies = headers.getSetCookie();
// ['session=xyz789; Secure; Path=/', 'prefs=dark_mode; Max-Age=3600']
```

**Structured input**: Set the `Set-Cookie` header using a structured object or array of objects.

```js
// Syntax
const cookie = { name, value, secure?, path?, expires?, maxAge?, httpOnly?, sameSite? };

headers.set('Set-Cookie', cookie);
headers.set('Set-Cookie', [cookie, ...]);
headers.append('Set-Cookie', cookie);
```

```js
// Example
headers.append('Set-Cookie', {
  name: 'session', 
  value: 'xyz789', 
  secure: true, 
  httpOnly: true, 
  sameSite: 'strict'
});
// Serializes to:
// 'session=xyz789; Secure; HttpOnly; SameSite=strict'
```

```js
// Example (multiple)
headers.set('Set-Cookie', [
  { name: 'session', value: 'xyz789', secure: true, httpOnly: true, sameSite: 'strict' },
  { name: 'prefs', value: 'dark_mode', maxAge: 3600 }
]);
// Translates to:
// append('Set-Cookie', 'session=xyz789; Secure; HttpOnly; SameSite=strict')
// append('Set-Cookie', 'prefs=dark_mode; Max-Age=3600')
```

**The default**: Set as raw strings.

```js
headers.append('Set-Cookie', 'session=xyz789; Secure; HttpOnly; SameSite=strict');
```

#### The `Range` Request Header

**Structured output**: Get the `Range` header as a structured array of range arrays, complete with helper methods.

```js
// Syntax
const ranges = headers.get('Range', true);
```

```js
// Example
const ranges = headers.get('Range', true);
// [
//   [0, 500], 
//   [1000, 1500]
// ]

// toString
ranges[0].toString(); // '0-500'
ranges[1].toString(); // '1000-1500'

// Compute against concrete resource length
const resourceLength = 1200;

ranges[0].canResolveAgainst(0/*start*/, resourceLength/*total*/); // true
ranges[0].resolveAgainst(resourceLength); // [0, 499]

ranges[1].canResolveAgainst(0/*start*/, resourceLength/*total*/); // false
ranges[1].resolveAgainst(resourceLength); // [1000, 1199]
```

...with nulls:

```js
// Example
const ranges = headers.get('Range', true);
// [
//   [0, null], 
//   [null, 1500]
// ]

// toString
ranges[0].toString(); // '0-'
ranges[1].toString(); // '-1500'

// Compute against concrete resource length
const resourceLength = 1200;

ranges[0].canResolveAgainst(0/*start*/, resourceLength/*total*/); // true
ranges[0].resolveAgainst(resourceLength); // [0, 1199]

ranges[1].canResolveAgainst(0/*start*/, resourceLength/*total*/); // false
ranges[1].resolveAgainst(resourceLength); // [0, 1199]
```

**The default**: Get as raw strings.

```js
const ranges = headers.get('Range');
// 'bytes=0-500, 1000-1500'
```

...with nulls:

```js
const ranges = headers.get('Range');
// 'bytes=0-, -1500'
```

**Structured input**: Set the `Range` header using an array of ranges (strings or arrays).

```js
// Syntax
const arraySyntax = [ [start?, end?], ... ];
const stringSyntax = [ '<start>-<end>', ... ];

headers.set('Range', arraySyntax);
headers.set('Range', stringSyntax);
```

```js
// Example
headers.set('Range', [[0, 500], [1000, 1500]]);
// Serializes to: 'bytes=0-500, 1000-1500'

// ...with nulls
headers.set('Range', [[0, null], [null, 1500]]);
// Serializes to: 'bytes=0-, -1500'
```

```js
// Example (alt)
headers.set('Range', ['0-500', '1000-1500']);
// Serializes to: 'bytes=0-500, 1000-1500'
```

**The default**: Set as raw strings.

```js
headers.set('Range', 'bytes=0-500, 1000-1500');
```

#### The `Content-Range` Response Header

**Structured output**: Get the `Content-Range` header as a structured array.

```js
// Syntax
const contentRange = headers.get('Content-Range', true);
```

```js
// Example
headers.get('Content-Range', true);
// ['0-499', '1234']
```

**The default**: Get as a raw string.

```js
headers.get('Content-Range');
// 'bytes 0-499/1234'
```

**Structured input**: Set the `Content-Range` header using a structured array.

```js
// Syntax
headers.set('Content-Range', ['<start>-<end>', '<total>']);
```

```js
// Example
headers.set('Content-Range', ['0-499', '1234']);
// Serializes to:
// 'bytes 0-499/1234'
```

> If the structured input does not match the required shape, an error is thrown.

**The default**: Set as a raw string.

```js
headers.set('Content-Range', 'bytes 0-499/1234');
```

#### The `Accept` Request Header

**Structured output**: Get the `Accept` header as a specialized object for content negotiation.

```js
// Syntax
const accept = headers.get('Accept', true);
```

```js
// Example
const accept = headers.get('Accept', true);
// [
//   [ 'text/html', 1 ],
//   [ 'application/json', 0.9 ],
//   [ 'image/*', 0.8 ]
// ]

// toString
accept.toString(); // 'text/html,application/json;q=0.9,image/*;q=0.8'

// Check priority with match()
accept.match('text/html'); // 1.0
accept.match('application/json'); // 0.9
accept.match('image/webp'); // 1.8 (matching image/*)
accept.match('image/svg+xml'); // 0 (not found is 0)
```

**The default**: Get as raw strings.

```js
headers.get('Accept'); // 'text/html,application/json;q=0.9,image/*;q=0.8'
```

**Structured input**: Set the `Accept` header using an array of MIME types.

```js
// Syntax
const arraySyntax = [ [mime, q?], ... ];
const stringSyntax = [ '<mime>;q=<q>', ... ];

headers.set('Accept', arraySyntax);
headers.set('Accept', stringSyntax);
```

```js
// Example
headers.set('Accept', [
    ['text/html', 1], 
    ['application/json', 0.9], 
    ['image/*', 0.8]
]);
// Serializes to: 'text/html,application/json;q=0.9,image/*;q=0.8'
```

**The default**: Set as raw strings.

```js
headers.set('Accept', 'text/html,application/json;q=0.9,image/*;q=0.8');
```

### JSON-Native FormData Interface  – `FormDataPlus`

`FormDataPlus` is an extension of the `FormData` interface that adds support for a JSON output method and a JSON factory method:

```js
// Format to JSON
const json = await formData.json();
```

```js
// Create an instance from JSON
const formData = FormDataPlus.json(json);
```

This makes `FormData` pair nicely with sibling interfaces like `Response` that already work this way:

```js
// Read as JSON
const json = await response.json();
```

```js
// Create an instance from JSON
const response = Response.json(json);
```

`FormDataPlus` is the _FormData_ interface exposed by `RequestPlus#formData()` and `ResponsePlus#formData()`:

```js
const request = new RequestPlus();
console.log(await request.formData()); // FormDataPlus
```

It can also be directly instantiated:

```js
import { FormDataPlus } from 'fetch-plus';

const formData = new FormDataPlus();
formData.set('key', 'value');
```

#### The `.json()` Instance Method

The `.json()` method is an output method that returns the instance as a JSON object.

**Signature**:

+ `.json()`: `Promise<object>`
+ `.json({ decodeLiterals?, meta? })`: `Promise<object>`

**Options**:

+ `decodeLiterals`: `boolean` Controls whether JSON primitives (`null`, `true`, `false`) originally encoded as `Blobs` in the instance are decoded back to their literal JSON value. Defaults to `true`.
+ `meta`: `boolean` Controls whether conversion-specific metadata are added to the returned structure. When true, the result is returned in a `{ result, ...meta }` structure – with `result` being the actual JSON result and `...meta` being metadata about the result.
  
  + `result`: `object`. The actual JSON result.
  + `isDirectlySerializable`: `boolean`. This is true if the returned JSON is directly serializable to a JSON string – implying that there are no compound data types, like `Blobs`, in the structure. It is false otherwise.

**Example 1: _Direct JSON representation_**

Call `json()` and get back a corresponding JSON representation of the instance. Note that bracket key notations produce equivalent depth in the resulting JSON tree.

```js
const formData = new FormDataPlus();

formData.append('name', 'Alice');
formData.append('age', '30');
formData.append('skills[]', 'JS');
formData.append('skills[]', 'Testing');

const json = await formData.json();

console.log(json);
// {
//     name: 'Alice',
//     age: 30,
//     skills: ['JS', 'Testing']
// }
```

**Example 2: _Handle special data types_**

FormData has no concept of JSON primitives (`null`, `true`, `false`). Encode them specially for lossless conversion.

```js
const formData = new FormDataPlus();

formData.append('name', 'Alice');
formData.append('age', '30');
formData.append('prefers_reduced_motion', new Blob(['true'], { type: 'application/json' }));
formData.append('avatar', new Blob([imageBytes], { type: 'image/png' }));
formData.append('skills[primary][]', 'JS');
formData.append('skills[primary][]', 'Testing');

const { result: json, isDirectlySerializable } = await formData.json({
    decodeLiterals: true/* the default */,
    meta: true,
});

console.log(json);
// {
//     name: 'Alice',
//     age: 30,
//     prefers_reduced_motion: true,
//     avatar: Blob,
//     skills: { primary: ['JS', 'Testing'] }
// }

console.log(isDirectlySerializable); // false
// Has avatar: Blob
```


#### The `.json()` Static Method

The `.json()` static method is a factory method for creating new FormData instances directly from JSON objects.

**Signature**:

+ `FormDataPlus.json(json)`: `FormDataPlus`
+ `FormDataPlus.json(json, { encodeLiterals?, meta? })`: `FormDataPlus`

**Options**:

+ `encodeLiterals`: `boolean` Controls whether JSON primitives (`null`, `true`, `false`) are encoded as `Blobs` in the instance to preserve their meaning. Defaults to `true`.
+ `meta`: `boolean` Controls whether conversion-specific metadata are added to the returned structure. When true, the result is returned in a `{ result, ...meta }` structure – with `result` being the actual `FormData` instance and `...meta` being metadata about the result.
  
  + `result`: `FormData`. The resulting `FormData` instance.
  + `isDirectlySerializable`: `boolean`. This is true if the input JSON is directly serializable to a JSON string – implying that there are no compound data types, like `Blobs`, in the structure. It is false otherwise.

**Example 1: _Direct JSON conversion_**

Call `json()` and get back a corresponding `FormData` representation of the JSON structure. Note that depth is modelled in bracket key notations.

```js
const json = {
    name: 'Alice',
    age: 30,
    skills: ['JS', 'Testing']
};

const formData = FormDataPlus.json(json);

console.log([...formData.keys()]);
// ['name', 'age', 'skills[0]', 'skills[1]']
```

**Example 2: _Handle special data types_**

FormData has no concept of JSON primitives (`null`, `true`, `false`). FormDataPlus automatically encodes them by default for lossless conversion.

```js
const json = {
    name: 'Alice',
    age: 30,
    prefers_reduced_motion: true,
    avatar: new Blob([imageBytes], { type: 'image/png' }),
    skills: { primary: ['JS', 'Testing'] }
};

const { result: formData, isDirectlySerializable } = FormDataPlus.json(json, {
    encodeLiterals: true/* the default */,
    meta: true,
});

console.log(formData.get('prefers_reduced_motion')); // Blob
console.log(formData.get('skills[primary][1]')); // "Testing"

console.log(isDirectlySerializable); // false
// Has avatar: Blob
```

---

## License

MIT

[npm-version-src]: https://img.shields.io/npm/v/@webqit/fetch-plus?style=flat&colorA=18181B&colorB=F0DB4F
[npm-version-href]: https://npmjs.com/package/@webqit/fetch-plus
[bundle-src]: https://img.shields.io/bundlephobia/minzip/@webqit/fetch-plus?style=flat&colorA=18181B&colorB=F0DB4F
[bundle-href]: https://bundlephobia.com/result?p=@webqit/fetch-plus
[license-src]: https://img.shields.io/github/license/webqit/fetch-plus.svg?style=flat&colorA=18181B&colorB=F0DB4F
