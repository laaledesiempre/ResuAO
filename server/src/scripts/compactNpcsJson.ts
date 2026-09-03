import fs from "node:fs";
import path from "node:path";

import { compactNpcsData, loadDefaultNpcsData, loadNpcsDataFromJsonFile } from "../npcData";

function resolveCliPath(value: string | undefined, fallback: string): string {
    if (!value?.trim()) {
        return fallback;
    }

    return path.resolve(process.cwd(), value);
}

function formatBytes(bytes: number): string {
    return `${(bytes / 1024).toFixed(1)} KB`;
}

function main(): void {
    const inputArg = process.argv[2]?.trim();
    const inputPath = inputArg ? resolveCliPath(inputArg, inputArg) : null;
    const outputPath = resolveCliPath(
        process.argv[3],
        inputPath ? inputPath.replace(/\.json$/i, ".compact.json") : path.resolve(process.cwd(), "reports/npcs.compact.json"),
    );
    const normalizedNpcs = inputPath ? loadNpcsDataFromJsonFile(inputPath) : loadDefaultNpcsData();
    const compactedNpcs = compactNpcsData(normalizedNpcs);
    const output = `${JSON.stringify(compactedNpcs, null, 4)}\n`;
    const inputSize = inputPath ? fs.statSync(inputPath).size : Buffer.byteLength(JSON.stringify(normalizedNpcs), "utf8");

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, "utf8");

    const outputSize = Buffer.byteLength(output, "utf8");
    const savedBytes = inputSize - outputSize;
    const savedPercent = inputSize > 0 ? (savedBytes / inputSize) * 100 : 0;

    console.log(`Compacted NPC dataset to ${outputPath}`);
    console.log(`Input: ${formatBytes(inputSize)}`);
    console.log(`Output: ${formatBytes(outputSize)}`);
    console.log(`Saved: ${formatBytes(savedBytes)} (${savedPercent.toFixed(2)}%)`);
}

main();
