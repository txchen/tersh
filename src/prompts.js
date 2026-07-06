import readline from "node:readline";

export function createNodePrompts({ stdin = process.stdin, stderr = process.stderr } = {}) {
  return {
    askText: (label) => askVisible(stdin, stderr, label),
    askSecret: (label) => askHidden(stdin, stderr, label),
  };
}

function askVisible(input, output, label) {
  const rl = readline.createInterface({ input, output });

  return new Promise((resolve) => {
    rl.question(label, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function askHidden(input, output, label) {
  const rl = readline.createInterface({ input, output, terminal: true });
  const originalWrite = rl._writeToOutput;

  rl._writeToOutput = function writeMuted(stringToWrite) {
    if (stringToWrite.includes(label)) {
      originalWrite.call(rl, stringToWrite);
    }
  };

  return new Promise((resolve) => {
    rl.question(label, (answer) => {
      rl._writeToOutput = originalWrite;
      rl.close();
      output.write("\n");
      resolve(answer);
    });
  });
}
