import { ok, err } from './types.js';
import type { Result, ValidationError } from './types.js';

export interface ArgDef {
  name: string;
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'path';
}

export interface FlagDef {
  name: string;
  short?: string;
  description: string;
  required: boolean;
  type: 'string' | 'number' | 'boolean' | 'path';
  default?: string | number | boolean;
  enum?: (string | number)[];
}

export interface OutputDef {
  format: 'json' | 'text' | 'csv' | 'tsv' | 'jsonl';
  jsonPath?: string;
  successPattern?: string;
}

export interface CommandDef {
  name: string;
  description: string;
  usage: string;
  args?: ArgDef[];
  flags?: FlagDef[];
  output: OutputDef;
  timeoutMs?: number;
}

export interface CliToolSpec {
  name: string;
  specVersion: '1';
  binary: string;
  binaryVersion: string;
  description: string;
  versionDetection: {
    command: string;
    pattern: string;
  };
  registration?: {
    resolvedPath: string;
    registeredAt: string;
    helpOutput: string;
  };
  triggers: {
    positive: string[];
    negative: string[];
  };
  globalFlags?: FlagDef[];
  commands: CommandDef[];
}

export const CLI_TOOL_SPEC_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  type: 'object',
  required: [
    'name',
    'specVersion',
    'binary',
    'binaryVersion',
    'description',
    'versionDetection',
    'triggers',
    'commands',
  ],
  properties: {
    name: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    specVersion: { type: 'string', const: '1' },
    binary: { type: 'string', minLength: 1 },
    binaryVersion: { type: 'string', minLength: 1 },
    description: { type: 'string', minLength: 1, maxLength: 500 },
    versionDetection: {
      type: 'object',
      required: ['command', 'pattern'],
      properties: {
        command: { type: 'string', minLength: 1 },
        pattern: { type: 'string', minLength: 1 },
      },
    },
    registration: {
      type: 'object',
      required: ['resolvedPath', 'registeredAt', 'helpOutput'],
      properties: {
        resolvedPath: { type: 'string', minLength: 1 },
        registeredAt: { type: 'string', minLength: 1 },
        helpOutput: { type: 'string', maxLength: 2000 },
      },
    },
    triggers: {
      type: 'object',
      required: ['positive', 'negative'],
      properties: {
        positive: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
        negative: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 },
        },
      },
    },
    globalFlags: { type: 'array', items: { $ref: '#/definitions/FlagDef' } },
    commands: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/definitions/CommandDef' },
    },
  },
  definitions: {
    ArgDef: {
      type: 'object',
      required: ['name', 'description', 'required', 'type'],
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1, maxLength: 500 },
        required: { type: 'boolean' },
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'path'] },
      },
    },
    FlagDef: {
      type: 'object',
      required: ['name', 'description', 'required', 'type'],
      properties: {
        name: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
        short: { type: 'string', pattern: '^[a-z]$' },
        description: { type: 'string', minLength: 1, maxLength: 500 },
        required: { type: 'boolean' },
        type: { type: 'string', enum: ['string', 'number', 'boolean', 'path'] },
        default: { type: ['string', 'number', 'boolean'] },
        enum: { type: 'array', items: { type: ['string', 'number'] } },
      },
    },
    CommandDef: {
      type: 'object',
      required: ['name', 'description', 'usage', 'output'],
      properties: {
        name: { type: 'string', minLength: 1 },
        description: { type: 'string', minLength: 1, maxLength: 500 },
        usage: { type: 'string', minLength: 1 },
        args: { type: 'array', items: { $ref: '#/definitions/ArgDef' } },
        flags: { type: 'array', items: { $ref: '#/definitions/FlagDef' } },
        output: { $ref: '#/definitions/OutputDef' },
        timeoutMs: { type: 'number', minimum: 1000, maximum: 300000 },
      },
    },
    OutputDef: {
      type: 'object',
      required: ['format'],
      properties: {
        format: {
          type: 'string',
          enum: ['json', 'text', 'csv', 'tsv', 'jsonl'],
        },
        jsonPath: { type: 'string' },
        successPattern: { type: 'string' },
      },
    },
  },
} as const;

/**
 * Validates a raw unknown input against the CliToolSpec schema.
 * Returns a typed CliToolSpec on success or an array of ValidationErrors on failure.
 */
export function validateSpec(input: unknown): Result<CliToolSpec, ValidationError[]> {
  const errors: ValidationError[] = [];

  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return err([{ path: '', message: 'Input must be an object' }]);
  }

  const obj = input as Record<string, unknown>;

  // name
  if (typeof obj['name'] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(obj['name'])) {
    errors.push({
      path: 'name',
      message: 'Must be a lowercase string matching /^[a-z][a-z0-9-]*$/',
    });
  }

  // specVersion
  if (obj['specVersion'] !== '1') {
    errors.push({ path: 'specVersion', message: 'Must equal "1"' });
  }

  // binary
  if (typeof obj['binary'] !== 'string' || obj['binary'].length === 0) {
    errors.push({ path: 'binary', message: 'Must be a non-empty string' });
  }

  // binaryVersion
  if (typeof obj['binaryVersion'] !== 'string' || obj['binaryVersion'].length === 0) {
    errors.push({
      path: 'binaryVersion',
      message: 'Must be a non-empty string',
    });
  }

  // description
  if (typeof obj['description'] !== 'string' || obj['description'].length === 0) {
    errors.push({ path: 'description', message: 'Must be a non-empty string' });
  } else if (obj['description'].length > 500) {
    errors.push({
      path: 'description',
      message: 'Must not exceed 500 characters',
    });
  }

  // versionDetection
  if (typeof obj['versionDetection'] !== 'object' || obj['versionDetection'] === null) {
    errors.push({ path: 'versionDetection', message: 'Must be an object' });
  } else {
    const vd = obj['versionDetection'] as Record<string, unknown>;
    if (typeof vd['command'] !== 'string' || vd['command'].length === 0) {
      errors.push({
        path: 'versionDetection.command',
        message: 'Must be a non-empty string',
      });
    }
    if (typeof vd['pattern'] !== 'string' || vd['pattern'].length === 0) {
      errors.push({
        path: 'versionDetection.pattern',
        message: 'Must be a non-empty string',
      });
    } else {
      try {
        const re = new RegExp(vd['pattern']);
        // Check for capture group
        if (!re.source.includes('(')) {
          errors.push({
            path: 'versionDetection.pattern',
            message: 'Pattern must contain at least one capture group',
          });
        }
      } catch {
        errors.push({
          path: 'versionDetection.pattern',
          message: 'Must be a valid regular expression',
        });
      }
    }
  }

  // registration (optional)
  if ('registration' in obj && obj['registration'] !== undefined) {
    if (typeof obj['registration'] !== 'object' || obj['registration'] === null) {
      errors.push({ path: 'registration', message: 'Must be an object' });
    } else {
      const reg = obj['registration'] as Record<string, unknown>;
      if (typeof reg['resolvedPath'] !== 'string' || reg['resolvedPath'].length === 0) {
        errors.push({
          path: 'registration.resolvedPath',
          message: 'Must be a non-empty string',
        });
      }
      if (typeof reg['registeredAt'] !== 'string' || reg['registeredAt'].length === 0) {
        errors.push({
          path: 'registration.registeredAt',
          message: 'Must be a non-empty string',
        });
      }
      if (typeof reg['helpOutput'] !== 'string') {
        errors.push({
          path: 'registration.helpOutput',
          message: 'Must be a string',
        });
      } else if (reg['helpOutput'].length > 2000) {
        errors.push({
          path: 'registration.helpOutput',
          message: 'Must not exceed 2000 characters',
        });
      }
    }
  }

  // triggers
  if (typeof obj['triggers'] !== 'object' || obj['triggers'] === null) {
    errors.push({ path: 'triggers', message: 'Must be an object' });
  } else {
    const triggers = obj['triggers'] as Record<string, unknown>;
    if (!Array.isArray(triggers['positive']) || triggers['positive'].length === 0) {
      errors.push({
        path: 'triggers.positive',
        message: 'Must be an array with at least 1 element',
      });
    } else {
      triggers['positive'].forEach((item: unknown, i: number) => {
        if (typeof item !== 'string' || item.length === 0) {
          errors.push({
            path: `triggers.positive[${i}]`,
            message: 'Must be a non-empty string',
          });
        }
      });
    }
    if (!Array.isArray(triggers['negative']) || triggers['negative'].length === 0) {
      errors.push({
        path: 'triggers.negative',
        message: 'Must be an array with at least 1 element',
      });
    } else {
      triggers['negative'].forEach((item: unknown, i: number) => {
        if (typeof item !== 'string' || item.length === 0) {
          errors.push({
            path: `triggers.negative[${i}]`,
            message: 'Must be a non-empty string',
          });
        }
      });
    }
  }

  // globalFlags (optional)
  if ('globalFlags' in obj && obj['globalFlags'] !== undefined) {
    if (!Array.isArray(obj['globalFlags'])) {
      errors.push({ path: 'globalFlags', message: 'Must be an array' });
    } else {
      obj['globalFlags'].forEach((flag: unknown, i: number) => {
        validateFlagDef(flag, `globalFlags[${i}]`, errors);
      });
    }
  }

  // commands
  if (!Array.isArray(obj['commands']) || obj['commands'].length === 0) {
    errors.push({
      path: 'commands',
      message: 'Must be an array with at least 1 element',
    });
  } else {
    obj['commands'].forEach((cmd: unknown, i: number) => {
      validateCommandDef(cmd, `commands[${i}]`, errors);
    });
  }

  if (errors.length > 0) {
    return err(errors);
  }

  return ok(input as CliToolSpec);
}

function validateFlagDef(input: unknown, path: string, errors: ValidationError[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push({ path, message: 'Must be an object' });
    return;
  }
  const flag = input as Record<string, unknown>;
  if (typeof flag['name'] !== 'string' || !/^[a-z][a-z0-9-]*$/.test(flag['name'])) {
    errors.push({
      path: `${path}.name`,
      message: 'Must match /^[a-z][a-z0-9-]*$/',
    });
  }
  if ('short' in flag && flag['short'] !== undefined) {
    if (typeof flag['short'] !== 'string' || !/^[a-z]$/.test(flag['short'])) {
      errors.push({
        path: `${path}.short`,
        message: 'Must be a single lowercase letter',
      });
    }
  }
  if (typeof flag['description'] !== 'string' || flag['description'].length === 0) {
    errors.push({
      path: `${path}.description`,
      message: 'Must be a non-empty string',
    });
  } else if (flag['description'].length > 500) {
    errors.push({
      path: `${path}.description`,
      message: 'Must not exceed 500 characters',
    });
  }
  if (typeof flag['required'] !== 'boolean') {
    errors.push({ path: `${path}.required`, message: 'Must be a boolean' });
  }
  if (!['string', 'number', 'boolean', 'path'].includes(flag['type'] as string)) {
    errors.push({
      path: `${path}.type`,
      message: 'Must be one of: string, number, boolean, path',
    });
  }
}

function validateArgDef(input: unknown, path: string, errors: ValidationError[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push({ path, message: 'Must be an object' });
    return;
  }
  const arg = input as Record<string, unknown>;
  if (typeof arg['name'] !== 'string' || arg['name'].length === 0) {
    errors.push({
      path: `${path}.name`,
      message: 'Must be a non-empty string',
    });
  }
  if (typeof arg['description'] !== 'string' || arg['description'].length === 0) {
    errors.push({
      path: `${path}.description`,
      message: 'Must be a non-empty string',
    });
  } else if (arg['description'].length > 500) {
    errors.push({
      path: `${path}.description`,
      message: 'Must not exceed 500 characters',
    });
  }
  if (typeof arg['required'] !== 'boolean') {
    errors.push({ path: `${path}.required`, message: 'Must be a boolean' });
  }
  if (!['string', 'number', 'boolean', 'path'].includes(arg['type'] as string)) {
    errors.push({
      path: `${path}.type`,
      message: 'Must be one of: string, number, boolean, path',
    });
  }
}

function validateOutputDef(input: unknown, path: string, errors: ValidationError[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push({ path, message: 'Must be an object' });
    return;
  }
  const output = input as Record<string, unknown>;
  if (!['json', 'text', 'csv', 'tsv', 'jsonl'].includes(output['format'] as string)) {
    errors.push({
      path: `${path}.format`,
      message: 'Must be one of: json, text, csv, tsv, jsonl',
    });
  }
}

function validateCommandDef(input: unknown, path: string, errors: ValidationError[]): void {
  if (typeof input !== 'object' || input === null) {
    errors.push({ path, message: 'Must be an object' });
    return;
  }
  const cmd = input as Record<string, unknown>;
  if (typeof cmd['name'] !== 'string' || cmd['name'].length === 0) {
    errors.push({
      path: `${path}.name`,
      message: 'Must be a non-empty string',
    });
  }
  if (typeof cmd['description'] !== 'string' || cmd['description'].length === 0) {
    errors.push({
      path: `${path}.description`,
      message: 'Must be a non-empty string',
    });
  } else if (cmd['description'].length > 500) {
    errors.push({
      path: `${path}.description`,
      message: 'Must not exceed 500 characters',
    });
  }
  if (typeof cmd['usage'] !== 'string' || cmd['usage'].length === 0) {
    errors.push({
      path: `${path}.usage`,
      message: 'Must be a non-empty string',
    });
  }
  if ('args' in cmd && cmd['args'] !== undefined) {
    if (!Array.isArray(cmd['args'])) {
      errors.push({ path: `${path}.args`, message: 'Must be an array' });
    } else {
      cmd['args'].forEach((arg: unknown, i: number) => {
        validateArgDef(arg, `${path}.args[${i}]`, errors);
      });
    }
  }
  if ('flags' in cmd && cmd['flags'] !== undefined) {
    if (!Array.isArray(cmd['flags'])) {
      errors.push({ path: `${path}.flags`, message: 'Must be an array' });
    } else {
      cmd['flags'].forEach((flag: unknown, i: number) => {
        validateFlagDef(flag, `${path}.flags[${i}]`, errors);
      });
    }
  }
  if ('output' in cmd) {
    validateOutputDef(cmd['output'], `${path}.output`, errors);
  } else {
    errors.push({ path: `${path}.output`, message: 'Required field missing' });
  }
  if ('timeoutMs' in cmd && cmd['timeoutMs'] !== undefined) {
    if (typeof cmd['timeoutMs'] !== 'number') {
      errors.push({ path: `${path}.timeoutMs`, message: 'Must be a number' });
    } else if (cmd['timeoutMs'] < 1000 || cmd['timeoutMs'] > 300000) {
      errors.push({
        path: `${path}.timeoutMs`,
        message: 'Must be between 1000 and 300000',
      });
    }
  }
}
