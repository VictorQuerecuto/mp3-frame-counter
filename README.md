# MP3 Frame Counter

A small Node.js + TypeScript HTTP service that accepts an MP3 upload and returns the number of
MPEG-1 Layer III audio frames in it. The MP3 parsing is written by hand (no audio or ID3
libraries), and the upload is streamed straight into the parser, so files of any size are
counted with constant memory.

```console
$ curl -F "file=@test/fixtures/sample.mp3" http://localhost:3000/file-upload
{"frameCount":6089}
```

`6089` is the same count `mediainfo --Inform="Audio;%FrameCount%" sample.mp3` reports.

---

## Quick start

**Prerequisites:** Node.js **22.12 or later** (see [Node version](#node-22)) and npm.

```bash
npm install

# Development: auto-reloads on save, human-readable logs
npm run dev

# Production: compile to dist/, then run the compiled JavaScript
npm run build
npm start
```

The server listens on `http://127.0.0.1:3000` by default. Try it:

```bash
curl -F "file=@test/fixtures/sample.mp3" http://localhost:3000/file-upload
# {"frameCount":6089}

curl -i -F "file=@README.md" http://localhost:3000/file-upload
# HTTP/1.1 415 Unsupported Media Type
# {"error":{"code":"NOT_AN_MP3","message":"No MPEG audio frames were found. The file does not appear to be an MP3."}}
```

### With Docker

```bash
docker build -t mp3-frame-counter .
docker run --rm -p 3000:3000 mp3-frame-counter
```

### Configuration

All settings are optional environment variables. Invalid values stop the server at startup
with a message naming the variable.

| Variable        | Default     | Meaning                                                      |
| --------------- | ----------- | ------------------------------------------------------------ |
| `PORT`          | `3000`      | Port to listen on                                            |
| `HOST`          | `127.0.0.1` | Interface to bind (`0.0.0.0` to accept outside connections)  |
| `MAX_FILE_SIZE` | `209715200` | Largest accepted upload, in bytes (200 MB)                   |
| `LOG_LEVEL`     | `info`      | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

```bash
PORT=8080 MAX_FILE_SIZE=52428800 npm start   # 50 MB limit on port 8080
```

### Tests and code quality

```bash
npm test             # all unit + integration tests (Vitest)
npm run lint         # ESLint with typescript-eslint's strict type-checked rules
npm run typecheck    # tsc --noEmit
npm run format       # Prettier (format:check to verify only)
```

The same checks run in CI on every push and pull request (`.github/workflows/ci.yml`).

---

## API

### `POST /file-upload`

Send the file as `multipart/form-data` in a field named `file`.

**200 OK**

```json
{ "frameCount": 6089 }
```

**Errors** all share one shape, with `Content-Type: application/json`:

```json
{ "error": { "code": "NOT_AN_MP3", "message": "No MPEG audio frames were found. ..." } }
```

| Status | Code                      | When                                                                   |
| ------ | ------------------------- | ---------------------------------------------------------------------- |
| 400    | `INVALID_UPLOAD`          | Not `multipart/form-data`, or a malformed multipart body               |
| 400    | `NO_FILE`                 | The form contains no file                                              |
| 400    | `WRONG_FIELD`             | The file was sent in a field other than `file` (the message names it)  |
| 400    | `EMPTY_FILE`              | The file has no content                                                |
| 413    | `FILE_TOO_LARGE`          | Larger than `MAX_FILE_SIZE`                                            |
| 415    | `NOT_AN_MP3`              | No MPEG audio frames found at all (an image, a text file, ...)         |
| 422    | `UNSUPPORTED_MPEG_FORMAT` | MPEG audio, but not MPEG-1 Layer III (the message names the format)    |
| 404    | `NOT_FOUND`               | Unknown route                                                          |
| 405    | `METHOD_NOT_ALLOWED`      | `GET`/`PUT`/`PATCH`/`DELETE` on `/file-upload` (sends `Allow: POST`)   |
| 500    | `INTERNAL_ERROR`          | A bug on our side. The message is generic; details go to the logs only |

---

## How the frame counting works

An MP3 file is mostly a chain of **frames**, each holding 1152 audio samples (about 26 ms), laid
end to end. Optional tags may come before and after them:

```
[ ID3v2 tag ][frame][frame][frame] ... [frame][ APEv2 tag ][ ID3v1 tag ]
  optional                                       optional    optional
```

### The frame header

Every frame starts with a 4-byte header:

```
 byte 0    byte 1    byte 2    byte 3
AAAAAAAA  AAABBCCD  EEEEFFGH  IIJJKLMM

A  sync: 11 bits, all set           E  bitrate index    → lookup table (e.g. 9 → 128 kbps)
B  version (11 = MPEG-1)            F  sample-rate index → 44100 / 48000 / 32000 Hz
C  layer   (01 = Layer III)         G  padding bit (frame is 1 byte longer)
D  protection (0 = 16-bit CRC follows the header)
I  channel mode (stereo, joint stereo, dual channel, mono)    H, J-M  not needed for counting
```

Headers don't store the frame's length; it is computed:

```
frameLength = floor(144 × bitrate / sampleRate) + padding
```

`144` is `1152 samples ÷ 8 bits per byte`. For example, 128 kbps at 44.1 kHz gives
`floor(417.96) = 417` bytes, and the encoder sets the padding bit on some frames (418 bytes) to
keep the average bitrate exact.

Headers that are reserved or forbidden (bitrate index 0 "free format" or 15, sample-rate
index 3, reserved version/layer bits) are treated as invalid. Other MPEG versions and layers are
recognised only so they can be reported as unsupported.

### Walking the file

The counter is a small state machine (`src/mp3/frameCounter.ts`):

1. **Skipping tags.** If the file starts with `ID3`, read the tag's size and jump over it. The
   size is _synchsafe_ (7 bits per byte, so it can never look like a frame sync). Repeat, since
   tags can be stacked.
2. **Searching.** Find a header to start from. A candidate is only trusted if the position it
   points to (where the next frame should start) holds another valid header, an end-of-file
   tag, or the exact end of the input. `0xFFFx` byte pairs occur by chance in non-audio data,
   so this double-check prevents counting false syncs. (In a test, 1 MB of random bytes
   contains 21 valid-looking headers and yields 0 frames.)
3. **Hopping.** Read the header, jump `frameLength` bytes, repeat. Only 4 bytes per frame are
   ever inspected. If the bytes where a header should be are:
   - `TAG` (ID3v1) or `APETAGEX` (APEv2): the audio is over; stop.
   - `ID3`: an ID3v2 tag between frames; skip it and keep hopping.
   - anything else: the trail is lost (corruption); go back to searching.
4. **End of input.** A frame is counted only once all of its bytes have arrived, so a
   truncated final frame is **not** counted.

### The Xing/Info/VBRI frame

Many encoders (LAME, which produced the sample) make the first frame a **metadata frame**: a
valid MPEG frame whose payload is a summary of the file (frame count, seek table) instead of
audio. It is identified by the text `Xing` or `Info` placed right after the frame's _side
information_ (32 bytes for stereo, 17 for mono, plus 2 if there is a CRC), or `VBRI` at a fixed
offset of 36 bytes. Only the first frame is checked; later frames are audio, where those bytes
could appear by chance.

**It is not counted by default**, because that matches `mediainfo`. The evidence for the
sample file:

| Source                                                | Frames |
| ----------------------------------------------------- | ------ |
| Frames physically in the file (walked by this parser) | 6090   |
| `mediainfo` FrameCount                                | 6089   |
| Frame count LAME stored inside the Xing frame itself  | 6089   |
| `mediainfo` sample count ÷ 1152 (7,014,528 ÷ 1152)    | 6089   |

mediainfo's audio stream size is also exactly 208 bytes (the Xing frame's length) smaller than
the frame data. The choice is a named constant, `COUNT_METADATA_FRAME` in
`src/mp3/constants.ts`, and can be overridden per counter:
`new FrameCounter({ countMetadataFrame: true })` gives 6090.

---

## Design decisions and trade-offs

**Pure parser, separate from HTTP.** `src/mp3/` has no HTTP dependencies and exposes a small
API (`countFrames(asyncIterable)` and `FrameCounter`). It is tested on its own with synthetic
byte buffers built in `test/helpers/mp3Builder.ts`, so most tests don't depend on the sample
file.

**Streaming with constant memory.** The upload stream from `@fastify/multipart` is passed
directly to `countFrames`; nothing is buffered or written to disk. Frame bodies and tags are
skipped by count, never stored. The only bytes kept between chunks are a small leftover when a
decision straddles a chunk boundary (at most a header plus one frame of lookahead, about
1.4 KB), and only that leftover is ever copied, so total work is linear in the file size, with
no O(n²) concatenation. Tests feed the same files in 1-byte, random-size and large chunks and
require identical counts.

Measured on a laptop (Apple Silicon, Node 22, upload over localhost), sending the sample
concatenated with itself:

| Upload | Peak server memory |
| ------ | ------------------ |
| 14 MB  | 87 MB              |
| 139 MB | 152 MB             |
| 695 MB | 174 MB             |
| 2.0 GB | 170 MB             |

Memory levels off at Node's normal working set instead of growing with the file. The 695 MB
upload was counted in 0.35 s, because only 4 bytes of each frame are ever inspected.

**Size-limit gotcha.** When the multipart file stream is read directly, the plugin signals the
size limit by ending the stream early and setting `file.truncated`, not by throwing. The route
checks it explicitly; otherwise an oversized upload would get a 200 with a partial count. An
integration test covers the exact boundary (a file of exactly the limit passes, one frame more
is rejected).

**415 vs 422.** Both mean "no MPEG-1 Layer III frames found". The counter also records the
first well-formed header of another MPEG version or layer it meets. If there was one, the file
is real MPEG audio in an unsupported format (422, and the message names it); otherwise it isn't
an MP3 at all (415). Bitrate and sample-rate values that are invalid in every MPEG version are
rejected before this check, so for example a JPEG's `FF E2` marker isn't reported as MPEG-2.5
audio.

**Fastify over Express.** It brings an official streaming multipart plugin with size limits,
structured logging (pino), `inject()` for fast integration tests without opening a port, and
central not-found and error hooks, which together give every error the same JSON shape.

**Errors never leak internals.** Every error leaves through one handler that translates known
errors to the table above. Anything unrecognised becomes a generic 500 and is logged with its
stack trace server-side. A test checks that an internal error's message doesn't reach the
client.

**Graceful shutdown.** On `SIGINT`/`SIGTERM` the server stops accepting connections, lets
in-flight uploads finish (verified with a deliberately slow upload), and forces an exit after
10 seconds.

<a id="node-22"></a>**Node 22.** Node 20 reached end-of-life in April 2026, and Vitest 5
requires Node 22.12 or later, so that is the minimum (`engines`, `.nvmrc`, `@types/node`).

**Out of scope, by design.** MPEG-2, MPEG-2.5 and Layers I/II use different bitrate tables,
samples per frame and length formulas. They are detected and rejected (422) rather than
counted. Free-format streams (bitrate index 0) are treated as invalid, because their frame
length can't be computed from the header.

---

## Project structure

```
src/
├── mp3/                    Framework-agnostic MP3 parsing
│   ├── types.ts            FrameHeader, MpegVersion, ChannelMode, result types
│   ├── constants.ts        Lookup tables, COUNT_METADATA_FRAME
│   ├── frameHeader.ts      Decode a 4-byte header, frame length formula
│   ├── id3v2.ts            ID3v2 tag size (synchsafe)
│   ├── metadataFrame.ts    Xing / Info / VBRI detection
│   ├── frameCounter.ts     Streaming state machine, countFrames()
│   └── index.ts            Public API of the module
├── http/
│   ├── app.ts              Fastify app: multipart, routes, 404, central error handler
│   ├── routes/fileUpload.ts
│   └── errors.ts           HttpError and error translation
├── config.ts               Typed environment configuration
└── server.ts               Entry point, graceful shutdown
test/
├── unit/                   Parser, tags, Xing, chunk boundaries, config
├── integration/            The HTTP API through Fastify inject()
├── helpers/                Synthetic MP3 builder, chunking, multipart helpers
└── fixtures/sample.mp3
```

---

## Improvements with more time

- **Other formats:** MPEG-2/2.5 (576 samples per Layer III frame, so `72 × bitrate /
sampleRate`) and Layers I/II (Layer I uses 4-byte slots: `(12 × bitrate / sampleRate +
padding) × 4`), behind the same counter.
- **Free-format bitrate:** infer the frame length from the distance between the first two
  syncs.
- **Stricter resynchronisation:** require several consecutive valid frames with the same sample
  rate and channel mode, and use the Xing/VBRI frame count as a cross-check.
- **CRC verification** for frames with protection enabled.
- **Production hardening:** rate limiting (`@fastify/rate-limit`), authentication, request and
  idle timeouts, a health-check endpoint, metrics (e.g. Prometheus), and an OpenAPI description
  (`@fastify/swagger`).
- **Storage:** stream the upload to object storage (e.g. S3) in parallel with counting, if the
  file needs to be kept.
- **Benchmarks in CI:** a load test (e.g. autocannon) and a parser micro-benchmark, tracked over
  time to catch performance regressions.
