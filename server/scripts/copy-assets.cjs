const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");

const assets = ["jsons", "mapas_source"];

function copyRecursive(source, target) {
    if (!fs.existsSync(source)) {
        return;
    }

    fs.mkdirSync(target, { recursive: true });

    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const targetPath = path.join(target, entry.name);

        if (entry.isDirectory()) {
            copyRecursive(sourcePath, targetPath);
            continue;
        }

        fs.copyFileSync(sourcePath, targetPath);
    }
}

for (const asset of assets) {
    copyRecursive(path.join(root, asset), path.join(dist, asset));
}

console.log("Assets copied to dist/");
