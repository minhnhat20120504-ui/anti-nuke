import express from "express";
import {
  Client,
  GatewayIntentBits,
  AuditLogEvent,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} from "discord.js";

/* ================= WEB KEEP ALIVE ================= */
const app = express();
app.get("/", (req, res) => res.send("Bot is alive"));
app.listen(3000);

/* ================= CLIENT ================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildWebhooks
  ]
});

/* ================= CONFIG ================= */
const PREFIX = "n.";
const LIMIT = 1;
const TIME = 10000;
const LOG_CHANNEL_ID = "1474282173656989716";

/* ================= STORAGE ================= */
const antiNukeStatus = new Map(); // guild -> on/off
const createMap = new Map();
const deleteMap = new Map();
const roleDeleteMap = new Map();
const webhookDeleteMap = new Map();
const banMap = new Map();
const kickMap = new Map();

/* ================= HELPERS ================= */
function isOwner(guild, userId) {
  return guild.ownerId === userId;
}

function hit(map, key) {
  const now = Date.now();
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(now);
  map.set(
    key,
    map.get(key).filter(t => now - t < TIME)
  );
  return map.get(key).length;
}

async function punish(guild, user, reason) {
  try {
    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) return;

    if (isOwner(guild, user.id)) return;

    await member.ban({ reason }).catch(() => {});

    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle("🚨 Anti-Nuke Triggered")
      .setColor("Red")
      .addFields(
        { name: "User", value: `${user.tag} (${user.id})` },
        { name: "Action", value: reason },
        { name: "Guild", value: guild.name }
      )
      .setTimestamp();

    logChannel.send({ embeds: [embed] }).catch(() => {});
  } catch (err) {
    console.log("Punish error:", err);
  }
}

/* ================= READY + SLASH ================= */
const commands = [
  new SlashCommandBuilder()
    .setName("antinuke")
    .setDescription("Bật/tắt anti nuke")
    .addStringOption(opt =>
      opt.setName("trangthai")
        .setDescription("on hoặc off")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" }
        )
    )
    .toJSON()
];

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  try {
    await rest.put(
      Routes.applicationCommands(client.user.id),
      { body: commands }
    );
    console.log("✅ Slash registered");
  } catch (e) {
    console.error(e);
  }
});

/* ================= SLASH HANDLER ================= */
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "antinuke") return;

  if (!isOwner(interaction.guild, interaction.user.id)) {
    return interaction.reply({
      content: "❌ Chỉ chủ server dùng được.",
      ephemeral: true
    });
  }

  const state = interaction.options.getString("trangthai");
  const enabled = state === "on";

  antiNukeStatus.set(interaction.guild.id, enabled);

  interaction.reply(
    `🛡️ Anti-nuke đã **${enabled ? "BẬT" : "TẮT"}**`
  );
});

/* ================= PREFIX COMMAND ================= */
client.on("messageCreate", async msg => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith(PREFIX)) return;

  const args = msg.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = args.shift()?.toLowerCase();

  if (cmd === "antinuke") {
    if (!isOwner(msg.guild, msg.author.id)) {
      return msg.reply("❌ Chỉ chủ server dùng được.");
    }

    const state = args[0];
    if (!["on", "off"].includes(state)) {
      return msg.reply("Dùng: n.antinuke on/off");
    }

    const enabled = state === "on";
    antiNukeStatus.set(msg.guild.id, enabled);

    msg.reply(`🛡️ Anti-nuke đã **${enabled ? "BẬT" : "TẮT"}**`);
  }
});

/* ===================================================
   =============== ANTI NUKE EVENTS ==================
   =================================================== */

// ===== CHANNEL CREATE =====
client.on("channelCreate", async channel => {
  if (!antiNukeStatus.get(channel.guild.id)) return;

  const logs = await channel.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.ChannelCreate
  });

  const user = logs.entries.first()?.executor;
  if (!user) return;

  const key = `${channel.guild.id}-${user.id}`;
  if (hit(createMap, key) >= LIMIT) {
    punish(channel.guild, user, "Spam tạo kênh");
  }
});

// ===== CHANNEL DELETE =====
client.on("channelDelete", async channel => {
  if (!antiNukeStatus.get(channel.guild.id)) return;

  const logs = await channel.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.ChannelDelete
  });

  const user = logs.entries.first()?.executor;
  if (!user) return;

  const key = `${channel.guild.id}-${user.id}`;
  if (hit(deleteMap, key) >= LIMIT) {
    punish(channel.guild, user, "Spam xoá kênh");
  }
});

// ===== ROLE DELETE =====
client.on("roleDelete", async role => {
  if (!antiNukeStatus.get(role.guild.id)) return;

  const logs = await role.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.RoleDelete
  });

  const user = logs.entries.first()?.executor;
  if (!user) return;

  const key = `${role.guild.id}-${user.id}`;
  if (hit(roleDeleteMap, key) >= LIMIT) {
    punish(role.guild, user, "Spam xoá role");
  }
});

// ===== WEBHOOK DELETE =====
client.on("webhookUpdate", async channel => {
  if (!antiNukeStatus.get(channel.guild.id)) return;

  const logs = await channel.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.WebhookDelete
  });

  const user = logs.entries.first()?.executor;
  if (!user) return;

  const key = `${channel.guild.id}-${user.id}`;
  if (hit(webhookDeleteMap, key) >= LIMIT) {
    punish(channel.guild, user, "Spam xoá webhook");
  }
});

// ===== MASS BAN =====
client.on("guildBanAdd", async ban => {
  if (!antiNukeStatus.get(ban.guild.id)) return;

  const logs = await ban.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.MemberBanAdd
  });

  const user = logs.entries.first()?.executor;
  if (!user) return;

  const key = `${ban.guild.id}-${user.id}`;
  if (hit(banMap, key) >= LIMIT) {
    punish(ban.guild, user, "Mass ban");
  }
});

// ===== MASS KICK =====
client.on("guildMemberRemove", async member => {
  if (!antiNukeStatus.get(member.guild.id)) return;

  const logs = await member.guild.fetchAuditLogs({
    limit: 1,
    type: AuditLogEvent.MemberKick
  });

  const user = logs.entries.first()?.executor;
  if (!user) return;

  const key = `${member.guild.id}-${user.id}`;
  if (hit(kickMap, key) >= LIMIT) {
    punish(member.guild, user, "Mass kick");
  }
});

/* ================= LOGIN ================= */
client.login(process.env.TOKEN);
