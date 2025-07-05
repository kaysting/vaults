const crypto = require('crypto');
const readline = require('readline');
const bcrypt = require('bcrypt');

// Create a readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function secureRandomInt(min, max) {
    return Math.floor(crypto.randomBytes(4).readUInt32LE(0) / (0xFFFFFFFF + 1) * (max - min + 1)) + min;
}

// Function to generate a random password
function generateRandomPassword(length = 12) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let password = '';
    for (let i = 0; i < length; i++) {
        password += chars.charAt(secureRandomInt(0, chars.length - 1));
    }
    return password;
}

// Function to hash a password using bcrypt
async function hashPassword(password) {
    const saltRounds = 10;
    return await bcrypt.hash(password, saltRounds);
}

// Function to verify a password against a hash
async function verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
}

// Prompt the user for a password
rl.question('Enter a password (leave blank for a random one): ', async (input) => {
    const password = input || generateRandomPassword();
    const hashedPassword = await hashPassword(password);

    console.log(`Password: ${password}`);
    console.log(`Hash: ${hashedPassword}`);

    // Self-test feature
    if (await verifyPassword(password, hashedPassword)) {
        console.log('Self-test passed: The password matches the hash.');
    } else {
        console.log('Self-test failed: The password does not match the hash.');
    }

    rl.close();
});
