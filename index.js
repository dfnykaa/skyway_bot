const { 
    Client, 
    GatewayIntentBits, 
    EmbedBuilder, 
    REST, 
    Routes, 
    SlashCommandBuilder, 
    PermissionFlagsBits 
} = require('discord.js');
const fs = require('fs');
const path = require('path');


const TOKEN = process.env.DISCORD_TOKEN;
if (!TOKEN) {
    console.error('Chybí DISCORD_TOKEN v proměnných prostředí!');
    process.exit(1);
}
const CLIENT_ID = '1480123274170990674'; 

const BLACKLIST_CHANNEL_ID = '1552378277191090306'; 
const BLACKLIST_ROLE_ID = '1549476288551460935'; 
const COUNTER_CHANNEL_ID = '1555650966110478446';
const ALLOWED_ROLE_ID = '1553794693303898193';

const DATA_FILE = path.join(__dirname, 'blacklists.json');

function loadBlacklists() {
    if (!fs.existsSync(DATA_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch {
        return {};
    }
}

function saveBlacklists(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}


const client = new Client({ 
    intents: [
        GatewayIntentBits.Guilds, 
        GatewayIntentBits.GuildMembers
    ] 
});

const commands = [
    new SlashCommandBuilder()
        .setName('blacklist')
        .setDescription('Přidá uživateli roli Blacklist.')
        .addUserOption(option => option.setName('hrac').setDescription('Koho chceš dát na blacklist?').setRequired(true))
        .addStringOption(option => option.setName('duvod').setDescription('Důvod pro udělení blacklistu')),
        
    new SlashCommandBuilder()
        .setName('unb')
        .setDescription('Odebere uživateli roli Blacklist a zruší záznam.')
        .addUserOption(option => option.setName('hrac').setDescription('Komu chceš zrušit blacklist?').setRequired(true))
        .addStringOption(option => option.setName('duvod').setDescription('Důvod pro zrušení blacklistu'))
].map(command => command.toJSON());

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
    try {
        console.log('🔄 Registruji příkazy...');
        await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
        console.log('✅ Příkazy úspěšně zaregistrovány!');
    } catch (error) {
        console.error('Chyba při registraci příkazů:', error);
    }
})();


async function updateMemberCount() {
    try {
        const channel = await client.channels.fetch(COUNTER_CHANNEL_ID);
        if (!channel) return console.error('Čítací kanál nebyl nalezen.');

        const guild = channel.guild;
        await guild.members.fetch();
        
        const memberCount = guild.members.cache.filter(member => !member.user.bot).size;
        const newName = `👤┃Hráči: ${memberCount}`;

        if (channel.name !== newName) {
            await channel.setName(newName);
            console.log(`[${new Date().toLocaleTimeString()}] Název kanálu aktualizován na: ${newName}`);
        }
    } catch (error) {
        console.error('Chyba při aktualizaci kanálu:', error);
    }
}

client.once('ready', () => {
    console.log(`🤖 Bot ${client.user.tag} je spuštěn a připraven!`);
    
    client.user.setPresence({
        status: 'invisible'
    });

    updateMemberCount();
    setInterval(updateMemberCount, 10 * 60 * 1000);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const hasAllowedRole = interaction.member.roles.cache.has(ALLOWED_ROLE_ID);

    if (!isAdmin && !hasAllowedRole) {
        return interaction.reply({ content: 'Nemáš dostatečná oprávnění k použití tohoto příkazu!', ephemeral: true });
    }

    const { commandName } = interaction;
    const target = interaction.options.getMember('hrac');
    const logChannel = interaction.guild.channels.cache.get(BLACKLIST_CHANNEL_ID);

    if (!target) return interaction.reply({ content: 'Uživatel nebyl na serveru nalezen.', ephemeral: true });
    if (!logChannel) return interaction.reply({ content: 'Chyba: Nepodařilo se najít logovací místnost!', ephemeral: true });

    if (commandName === 'blacklist') {
        const reason = interaction.options.getString('duvod') || 'Neuveden';

        const blacklists = loadBlacklists();
        blacklists[target.id] = {
            reason: reason,
            date: new Date().toISOString(),
            admin: interaction.user.tag
        };
        saveBlacklists(blacklists);

        const blacklistEmbed = new EmbedBuilder()
            .setColor('#ce2f2f') 
            .setTitle('🚫 Blacklist')
            .addFields(
                { 
                    name: 'Hráč', 
                    value: `<@${target.id}> (${target.id}) byl úspěšně přidán na **blacklist**!` 
                },
                { 
                    name: 'Důvod', 
                    value: reason 
                }
            )
            .setFooter({ 
                text: `! ${interaction.user.username} | Admin • ${interaction.user.id}`, 
                iconURL: interaction.user.displayAvatarURL() 
            });

        const dmEmbed = new EmbedBuilder()
            .setColor('#ce2f2f')
            .setTitle(`🚫 Byl jsi přidán na Blacklist na serveru ${interaction.guild.name}`)
            .addFields(
                { name: 'Důvod', value: reason },
                { name: 'Administrátor', value: interaction.user.tag }
            )
            .setTimestamp();

        try {
            await target.roles.add(BLACKLIST_ROLE_ID); 
            await logChannel.send({ embeds: [blacklistEmbed] });

            let dmSent = true;
            try {
                await target.send({ embeds: [dmEmbed] });
            } catch {
                dmSent = false;
            }

            const responseText = dmSent 
                ? `Uživatel ${target.user.tag} dostal roli Blacklist a byla mu zaslána DM.` 
                : `Uživatel ${target.user.tag} dostal roli Blacklist (DM se nepodařilo doručit, má vypnuté soukromé zprávy).`;

            await interaction.reply({ content: responseText, ephemeral: true });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: 'Chyba: Nelze upravit role tohoto uživatele. Má bot vyšší roli než cílový uživatel?', ephemeral: true });
        }
    }

    if (commandName === 'unb') {
        const unblackReason = interaction.options.getString('duvod') || 'Neuveden';

        const blacklists = loadBlacklists();
        const originalReason = blacklists[target.id] ? blacklists[target.id].reason : 'Původní důvod nenalezen v databázi';

        const unblacklistEmbed = new EmbedBuilder()
            .setColor('#29c268')
            .setTitle('✅ Blacklist zrušen')
            .addFields(
                { 
                    name: 'Hráč', 
                    value: `<@${target.id}> (${target.id}) byl **odebrán** z blacklistu.` 
                },
                { 
                    name: 'Původní důvod blacklistu', 
                    value: originalReason 
                },
                { 
                    name: 'Důvod zrušení blacklistu', 
                    value: unblackReason 
                }
            )
            .setFooter({ 
                text: `! ${interaction.user.username} | Admin • ${interaction.user.id}`, 
                iconURL: interaction.user.displayAvatarURL() 
            });

        const unblackDmEmbed = new EmbedBuilder()
            .setColor('#29c268')
v          .setTitle(`✅ Tvůj Blacklist byl zrušen na serveru ${interaction.guild.name}`)
            .addFields(
                { name: 'Důvod zrušení', value: unblackReason },
                { name: 'Administrátor', value: interaction.user.tag }
            )
            .setTimestamp();

        try {
            await target.roles.remove(BLACKLIST_ROLE_ID); 
          	delete blacklists[target.id];
            saveBlacklists(blacklists);

            await logChannel.send({ embeds: [unblacklistEmbed] });

            let dmSent = true;
            try {
                await target.send({ embeds: [unblackDmEmbed] });
            } catch {
                dmSent = false;
            }

            const responseText = dmSent 
                ? `Uživatel ${target.user.tag} byl odebrán z blacklistu a byla mu zaslána DM.` 
                : `Uživatel ${target.user.tag} byl odebrán z blacklistu (DM se nepodařilo doručit, má vypnuté soukromé zprávy).`;

            await interaction.reply({ content: responseText, ephemeral: true });
        } catch (err) {
            console.error(err);
            await interaction.reply({ content: 'Chyba: Nelze odebrat roli tomuto uživateli.', ephemeral: true });
        }
    }
});

client.login(TOKEN);
