# CodeMirror Helix

[![codemirror-helix on npm](https://img.shields.io/npm/v/codemirror-helix?label=codemirror-helix)](https://www.npmjs.com/package/codemirror-helix)
[![codemirror-helix-cm5 on npm](https://img.shields.io/npm/v/codemirror-helix-cm5?label=codemirror-helix-cm5)](https://www.npmjs.com/package/codemirror-helix-cm5)

Helix-style editing for CodeMirror 6 and CodeMirror 5.

This repository is a fork of Roberto Vidal's original
[`codemirror-helix`](https://gitlab.com/_rvidal/codemirror-helix).

## Installation

CodeMirror 6:

```sh
npm install codemirror-helix
```

CodeMirror 5:

```sh
npm install codemirror@5 codemirror-helix-cm5
```

## Packages

- [`codemirror-helix`](./packages/codemirror-helix): CodeMirror 6 package, kept at
  version `0.6.0` and not published from this fork.
- [`codemirror-helix-core`](./packages/codemirror-helix-core): editor-independent
  shared engine.
- [`codemirror-helix-cm5`](./packages/codemirror-helix-cm5): CodeMirror 5 adapter.

## Development

```sh
npm ci
npm run lint
npm run build
npm test
```

Run `npm run demo` for CM6 or `npm run demo:cm5` for CM5.

## Acknowledgements

The shared-core and CM5 adapter structure was inspired by
[`codemirror-kakoune`](https://github.com/Yukaii/codemirror-kakoune) by Yukaii.

## License

[MPL-2.0](./LICENSE). Contributions must follow the
[DCO guide](./etc/CONTRIBUTING.md).
