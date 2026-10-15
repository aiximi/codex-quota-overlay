#!/usr/bin/env node
/**
 * hello-world.mjs
 *
 * A minimal "Hello, World!" program that follows common project conventions:
 * ES module syntax, a single entry point, and a guard so the logic can be
 * imported and tested without printing as a side effect.
 *
 * Usage:
 *   node scripts/hello-world.mjs
 */

/**
 * Returns the greeting text.
 *
 * @param {string} [name='World'] - Name to greet.
 * @returns {string} The greeting message.
 */
export function greet(name = 'World') {
  return `Hello, ${name}!`;
}

/**
 * Program entry point.
 */
function main() {
  console.log(greet());
}

// Run only when executed directly, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
