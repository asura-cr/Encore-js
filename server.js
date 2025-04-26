const express = require('express');
const { Client, Intents, MessageEmbed } = require('discord.js');
const crypto = require('crypto');
const cors = require('cors');
require('dotenv').config();

const app = express();
const client = new Client({ 
    intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES, Intents.FLAGS.DIRECT_MESSAGES],
    partials: ['CHANNEL'] // Needed for DM support
});

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Store credentials in memory (you could use a database if needed)
let credentials = new Map();

// Hash password with salt
function hashPassword(password, salt) {
    return crypto.createHash('sha256').update(password + salt).digest('hex');
}

// Generate random string
function generateRandom(length, chars) {
    return Array.from(crypto.randomFillSync(new Uint8Array(length)))
        .map((x) => chars[x % chars.length])
        .join('');
}

// Clean up expired credentials
function cleanupCredentials() {
    const now = Date.now() / 1000;
    for (const [username, data] of credentials.entries()) {
        if (data.expiry < now) {
            credentials.delete(username);
        }
    }
}

// Discord bot setup
client.once('ready', async () => {
    console.log('Bot is ready!');
    
    try {
        // Register slash command globally
        await client.application?.commands.create({
            name: 'generate',
            description: 'Generate login credentials'
        });
        console.log('Slash command registered');
    } catch (error) {
        console.error('Error registering slash command:', error);
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;
    if (interaction.commandName !== 'generate') return;

    try {
        // Clean up old credentials
        cleanupCredentials();

        // Generate credentials
        const username = generateRandom(8, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789');
        const password = generateRandom(12, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*');
        const expiry = Math.floor(Date.now() / 1000) + (12 * 60 * 60); // 12 hours

        // Store credentials
        credentials.set(username, {
            password: hashPassword(password, process.env.CREDENTIAL_SALT),
            expiry: expiry
        });

        // Create embed
        const embed = new MessageEmbed()
            .setTitle('Your Login Credentials')
            .setDescription('These credentials will expire in 12 hours.')
            .setColor('#00ff00')
            .addField('Username', `\`\`\`${username}\`\`\``, false)
            .addField('Password', `\`\`\`${password}\`\`\``, false)
            .addField('Expiry', `<t:${expiry}:R>`, false)
            .setFooter('Keep these credentials private!');

        // Send DM
        await interaction.user.send({ embeds: [embed] });
        await interaction.reply({ content: '✅ Credentials have been sent to your DMs!', ephemeral: false });

    } catch (error) {
        console.error('Error:', error);
        if (error.code === 50007) {
            await interaction.reply({ 
                content: '❌ Could not send credentials. Please enable DMs from server members!',
                ephemeral: true 
            });
        } else {
            await interaction.reply({ 
                content: '❌ An error occurred while generating credentials.',
                ephemeral: true 
            });
        }
    }
});

// API Endpoints
app.post('/api/validate', (req, res) => {
    const { username, password } = req.body;
    
    if (!username || !password) {
        return res.status(400).json({ valid: false, message: 'Missing credentials' });
    }

    const userData = credentials.get(username);
    if (!userData) {
        return res.status(401).json({ valid: false, message: 'Invalid credentials' });
    }

    const hashedPassword = hashPassword(password, process.env.CREDENTIAL_SALT);
    const now = Date.now() / 1000;

    if (userData.password === hashedPassword && userData.expiry > now) {
        return res.json({
            valid: true,
            expiry: userData.expiry
        });wher
    }

    return res.status(401).json({ valid: false, message: 'Invalid credentials' });
});

// Health check endpoint
app.get('/', (req, res) => {
    res.json({ status: 'ok' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    // Start Discord bot
    client.login(process.env.DISCORD_TOKEN);
}); 