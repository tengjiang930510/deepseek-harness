# Product branding

English | [中文](README.zh.md)

## Configure

Edit `product.yml` and replace the PNG files under `product-assets/`. Each product branch maintains one configuration. Paths resolve relative to `product.yml`, regardless of the command's working directory.

```yaml
name: 武汉地铁智能助手
logo: ./product-assets/logo.png
appIcon: ./product-assets/app-icon.png
```

`name` and `logo` are required. The same display name is used in every interface language. Names must be valid application filenames on macOS and Windows. Use a transparent PNG for the assistant logo and a square, preferably 1024-pixel PNG for the application icon. Omit `appIcon` to generate an application icon from the logo with a white background and safe inset.

## Build and run

Run these commands from the repository root after changing the configuration or images:

```sh
pnpm run build
pnpm run start:web
```

For Desktop, use `pnpm run start:desktop` after the build, or `pnpm run dev:desktop` to build and launch together. Existing packaging commands include the generated brand resources. Rebuild and reinstall to change installed application icons and names. macOS Launch Services and Windows Explorer may cache icons until the application is relaunched or reinstalled.

The build generates resources under `.dsh-build/product/` and copies them into Web and Desktop artifacts. Do not edit generated files. Source launchers and packaging reject missing or stale product artifacts and request a new build. Generation rejects missing, malformed, or unsupported images before publishing new resources.

## Display coverage

The product name and images supply the sidebar, new-session headline, running-status mark, browser title and favicon, PWA installation, Desktop welcome and shell copy, application icons, Windows tray, and installer artwork. Keep the `t4y-brand` bundle enabled for the assistant's brand slots. Its package name is an installation identifier and does not need changing for another product.

Branding does not change models, business tools, credentials, application IDs, update channels, user data directories, or protocol identifiers. Separate products that need independent installation and updates also need explicit deployment settings; see [Desktop configuration](../apps/desktop/README.md).
