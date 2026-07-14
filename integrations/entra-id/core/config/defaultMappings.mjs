// config/defaultMappings.js
// Default mappings used when creating a new target block.
import { createRequire } from 'module';
import { getAttributeDefaultMappings } from '../../settingsResolver.mjs';

const require = createRequire(import.meta.url);
const settingsSchema = require('../../ui/settingsSchema.json');

export const DEFAULT_MAPPINGS = getAttributeDefaultMappings(settingsSchema);
