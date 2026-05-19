# Hello Integration

This is a minimal example integration for developers.

It demonstrates:

- `manifest.json` metadata and settings
- `display.json` navigation, dashboard, history, settings, and schedule metadata
- `validate(context)`
- `sync(context)`
- use of the Marketplace SDK helpers in `../../../sdk`

The sync handler intentionally does not call any vendor API. It only writes a short run history entry so developers can test the Marketplace integration lifecycle quickly.

Run repository checks after copying or modifying this example:

```bash
npm test
```
