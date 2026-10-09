require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} = require('discord.js');
const pages = require('./data/quran-pages');

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DATA_DIR = path.resolve(__dirname, '../data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PAGE_CACHE_DIR = path.join(DATA_DIR, 'pages');
const MAX_PAGE = 604;
const DEFAULT_INTERVAL = 2 * 60 * 60 * 1000;
const timers = new Map();

if (!TOKEN || !CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in .env');
  process.exit(1);
}

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(PAGE_CACHE_DIR, { recursive: true });
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { users: {}, khutma: {} }; }
}
let state = loadState();
function saveState() {
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, STATE_FILE);
}
function parseDuration(input) {
  if (!input) return DEFAULT_INTERVAL;
  const match = String(input).trim().match(/^(\d+)\s*(m|h|d)$/i);
  if (!match) return null;
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const ms = value * ({ m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]);
  return ms >= 5 * 60_000 && ms <= 2 * 86_400_000 ? ms : null;
}
function pageNumber(value) {
  const page = Number(value || 1);
  return Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1;
}
function pageEmbed(page, color = '#2f9e44', attachmentName) {
  const item = pages[page];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`صفحة ${item.page} — ${item.name || 'المصحف'}`)
    .setDescription(`السورة: **${item.name || 'المصحف'}**\nالنوع: ${item.type_ar || '—'}\nعدد الآيات: ${item.verses || '—'}`)
    .setFooter({ text: 'Quran Pages & Khatma' });
  return attachmentName ? embed.setImage(`attachment://${attachmentName}`) : embed;
}
async function pageAttachment(page) {
  const item = pages[page];
  for (const extension of ['jpg', 'png']) {
    const cachedName = `quran-page-${page}.${extension}`;
    const cachedPath = path.join(PAGE_CACHE_DIR, cachedName);
    try {
      if (fs.statSync(cachedPath).size > 1000) return { attachment: cachedPath, name: cachedName };
    } catch {}
  }
  const sources = [
    item.musahaf,
    `https://raw.githubusercontent.com/GovarJabbar/Quran-PNG/master/${String(page).padStart(3, '0')}.png`
  ];
  let buffer;
  for (const source of sources) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(source, { signal: controller.signal });
      clearTimeout(timeout);
      if (!response.ok) continue;
      const candidate = Buffer.from(await response.arrayBuffer());
      if (candidate.length > 1000) {
        buffer = candidate;
        break;
      }
    } catch {}
  }
  if (!buffer) throw new Error(`تعذر تحميل صورة الصفحة ${page} من المصادر المتاحة`);
  const extension = buffer[0] === 0x89 && buffer[1] === 0x50 ? 'png' : 'jpg';
  const name = `quran-page-${page}.${extension}`;
  const filePath = path.join(PAGE_CACHE_DIR, name);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, buffer);
  fs.renameSync(temporaryPath, filePath);
  return { attachment: filePath, name };
}
async function pageMessage(page, color) {
  const file = await pageAttachment(page);
  return { embeds: [pageEmbed(page, color, file.name)], files: [file] };
}
function pageButtons(page, userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`quran:prev:${userId}:${page}`).setEmoji('◀️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`quran:save:${userId}:${page}`).setLabel('حفظ الصفحة').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`quran:next:${userId}:${page}`).setEmoji('▶️').setStyle(ButtonStyle.Success)
  );
}
function commandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName('quran').setDescription('عرض صفحة من المصحف والتنقل بينها')
      .addIntegerOption(o => o.setName('page').setDescription('رقم الصفحة من 1 إلى 604').setMinValue(1).setMaxValue(604)),
    new SlashCommandBuilder()
      .setName('khutma').setDescription('إدارة إرسال صفحة من المصحف بشكل دوري')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(s => s.setName('setup').setDescription('بدء أو تحديث الختمة')
        .addChannelOption(o => o.setName('channel').setDescription('القناة النصية').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .addStringOption(o => o.setName('interval').setDescription('المدة: 5m أو 2h أو 1d'))
        .addStringOption(o => o.setName('color').setDescription('لون Embed بصيغة 6 أرقام مثل 2f9e44')))
      .addSubcommand(s => s.setName('stop').setDescription('إيقاف الختمة'))
      .addSubcommand(s => s.setName('status').setDescription('عرض حالة الختمة'))
  ].map(c => c.toJSON());
}
function clearKhatma(guildId) {
  const timer = timers.get(guildId);
  if (timer) clearTimeout(timer);
  timers.delete(guildId);
}
function scheduleKhatma(client, guildId) {
  clearKhatma(guildId);
  const config = state.khutma[guildId];
  if (!config || !config.enabled) return;
  const timer = setTimeout(async () => {
    try {
      const channel = await client.channels.fetch(config.channelId);
      const nextPage = pageNumber(config.page + 1);
      await channel.send(await pageMessage(nextPage, config.color));
      config.page = nextPage;
      if (nextPage === MAX_PAGE) {
        await channel.send({ content: 'تمت الختمة بحمد الله.', files: [path.join(__dirname, 'data/khatam_AR.jpg')] });
        config.enabled = false;
      }
      saveState();
      scheduleKhatma(client, guildId);
    } catch (error) {
      console.error(`[khatma:${guildId}]`, error.message);
      scheduleKhatma(client, guildId);
    }
  }, config.intervalMs);
  timers.set(guildId, timer);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
client.once('clientReady', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  const route = GUILD_ID ? Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID) : Routes.applicationCommands(CLIENT_ID);
  try {
    await rest.put(route, { body: commandDefinitions() });
  } catch (error) {
    if (error.code === 50001 && GUILD_ID) {
      console.error(`Discord رفض الوصول إلى السيرفر ${GUILD_ID}. تأكد أن البوت مضاف إلى السيرفر وأن DISCORD_GUILD_ID صحيح.`);
      console.error(`رابط الدعوة: https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&permissions=2147485696&scope=bot%20applications.commands`);
    } else {
      console.error('تعذر تسجيل أوامر Discord:', error.message);
    }
    return;
  }
  for (const guildId of Object.keys(state.khutma)) scheduleKhatma(client, guildId);
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('error', (error) => console.error('Discord client error:', error.message));

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'quran') {
      const page = pageNumber(interaction.options.getInteger('page') || state.users[interaction.user.id] || 1);
      state.users[interaction.user.id] = page;
      saveState();
      return interaction.reply({ ...(await pageMessage(page)), components: [pageButtons(page, interaction.user.id)] });
    }
    if (interaction.isButton() && interaction.customId.startsWith('quran:')) {
      const [, action, owner, rawPage] = interaction.customId.split(':');
      if (owner !== interaction.user.id) return interaction.reply({ content: 'هذه الأزرار ليست لك.', ephemeral: true });
      let page = pageNumber(rawPage);
      if (action === 'prev') page = page === 1 ? MAX_PAGE : page - 1;
      if (action === 'next') page = page === MAX_PAGE ? 1 : page + 1;
      if (action === 'save') {
        state.users[interaction.user.id] = page;
        saveState();
        return interaction.reply({ content: `تم حفظ الصفحة ${page}.`, ephemeral: true });
      }
      state.users[interaction.user.id] = page;
      saveState();
      return interaction.update({ ...(await pageMessage(page)), components: [pageButtons(page, interaction.user.id)] });
    }
    if (interaction.isChatInputCommand() && interaction.commandName === 'khutma') {
      const sub = interaction.options.getSubcommand();
      if (sub === 'stop') {
        delete state.khutma[interaction.guildId]; saveState(); clearKhatma(interaction.guildId);
        return interaction.reply('تم إيقاف الختمة.');
      }
      if (sub === 'status') {
        const config = state.khutma[interaction.guildId];
        return interaction.reply(config?.enabled ? `الختمة فعالة في <#${config.channelId}>، الصفحة الحالية ${config.page}/604.` : 'لا توجد ختمة فعالة.');
      }
      const channel = interaction.options.getChannel('channel');
      const intervalMs = parseDuration(interaction.options.getString('interval'));
      const rawColor = interaction.options.getString('color') || '2f9e44';
      if (!intervalMs) return interaction.reply({ content: 'المدة يجب أن تكون بين 5 دقائق ويومين، مثل `2h`.', ephemeral: true });
      if (!/^[0-9a-f]{6}$/i.test(rawColor)) return interaction.reply({ content: 'اللون يجب أن يكون 6 أرقام، مثل `2f9e44`.', ephemeral: true });
      state.khutma[interaction.guildId] = { enabled: true, channelId: channel.id, intervalMs, page: 0, color: `#${rawColor}` };
      saveState(); scheduleKhatma(client, interaction.guildId);
      return interaction.reply(`تم تشغيل الختمة في <#${channel.id}> كل ${interaction.options.getString('interval') || '2h'}، وتبدأ من الصفحة 1.`);
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) interaction.reply({ content: 'حدث خطأ غير متوقع.', ephemeral: true }).catch(() => {});
  }
});

process.on('SIGINT', () => { for (const timer of timers.values()) clearTimeout(timer); client.destroy(); process.exit(0); });
process.on('SIGTERM', () => { for (const timer of timers.values()) clearTimeout(timer); client.destroy(); process.exit(0); });
client.login(TOKEN);
