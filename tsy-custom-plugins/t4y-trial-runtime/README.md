# t4y-trial-runtime

English | [中文](README.zh.md)

See [Enterprise plugin implementation and boundaries](../PLUGIN-REFERENCE.md#t4y-trial-runtime) for responsibilities, calls, state, and limitations.

The Wuhan Metro assistant runtime supplies Qwen model defaults and flash web search for trial and Desktop packages, using the `T4Y_NEW_API_KEY` credential reference for both LLM and search.

[`t4y-identity`](../t4y-identity/) and Key Broker handle login and **New API Key** issuance. This package only consumes the credential slot; it does not provide login UI or create keys.

## Install

```sh
pnpm dsh plugin --profile web add ./tsy-custom-plugins/t4y-trial-runtime
```

See [DEVELOPING.md](./DEVELOPING.md) for development and packaging.
