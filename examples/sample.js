// Sample file - for quick checks

/**
 * Function that prints Hello World
 */
function helloWorld() {
  console.log('Hello, World!');
}

/**
 * Function that adds two numbers
 * @param {number} a - first number
 * @param {number} b - second number
 * @returns {number} sum
 */
function add(a, b) {
  return a + b;
}

module.exports = {
  helloWorld,
  add
};

