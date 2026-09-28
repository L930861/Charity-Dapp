import fs from "node:fs";
import solc from "solc";
export function compile(extra = {}) {
  const sources = {
    "CharityFund.sol": {
      content: fs.readFileSync("contracts/CharityFund.sol", "utf8"),
    },
    ...extra,
  };
  const input = {
    language: "Solidity",
    sources,
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "shanghai",
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
        },
      },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = output.errors?.filter((x) => x.severity === "error") || [];
  if (errors.length)
    throw new Error(errors.map((x) => x.formattedMessage).join("\n"));
  return output.contracts;
}
if (process.argv[1]?.endsWith("compile.mjs")) {
  const artifact = compile()["CharityFund.sol"].CharityFund;
  fs.mkdirSync("artifacts", { recursive: true });
  fs.writeFileSync(
    "artifacts/CharityFund.json",
    JSON.stringify(
      {
        compiler: solc.version(),
        abi: artifact.abi,
        bytecode: "0x" + artifact.evm.bytecode.object,
      },
      null,
      2,
    ),
  );
  console.log("Compiled CharityFund with", solc.version());
}
