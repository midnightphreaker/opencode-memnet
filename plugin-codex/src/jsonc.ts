export function stripJsonc(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n") {
        i++;
      }
      if (i < input.length) {
        output += "\n";
      }
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        if (input[i] === "\n") {
          output += "\n";
        }
        i++;
      }
      i++;
      continue;
    }

    output += char;
  }

  return stripTrailingCommas(output);
}

export function parseJsonc<T>(input: string): T {
  return JSON.parse(stripJsonc(input)) as T;
}

function stripTrailingCommas(input: string): string {
  let output = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inString) {
      output += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === ",") {
      const rest = input.slice(i + 1);
      const trailing = rest.match(/^(\s*[}\]])/);
      if (trailing) {
        output += trailing[1];
        i += trailing[0].length;
        continue;
      }
    }

    output += char;
  }

  return output;
}
