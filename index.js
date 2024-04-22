import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import mysql from "mysql";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Client, GatewayIntentBits } from "discord.js";

dotenv.config();
const app = express();
const PORT = 8080;

const dbConnection = mysql.createConnection({
  host: "mysql.db.bot-hosting.net",
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

dbConnection.connect((err) => {
  if (err) throw err;
  console.log("Connected to MySQL!");
});

// Middleware to parse JSON bodies
app.use(express.json());

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessages,
  ],
});
client.login(process.env.DISCORD_BOT_TOKEN);

async function addAddress(address, channelId) {
  new Promise((resolve, reject) => {
    const query = `INSERT INTO subscriptions (wallet_address, channel_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id=id`;
    dbConnection.query(query, [address, channelId], (error, results) => {
      if (error) {
        return reject(error);
      }
      console.log(`Added address: ${address} for channel ID: ${channelId}`);
      resolve();
    });
  });
  const addresses = await listAllAddresses();
  console.log("Addresses:", addresses);
  const api = `https://api.helius.xyz/v0/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${process.env.HELIUS_API_KEY}`;
  const response = await fetch(api, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountAddresses: addresses,
      webhookURL: process.env.WEBHOOK_URL,
      transactionTypes: ["SWAP"],
      webhookType: "enhanced",
    }),
  });
  if (!response.ok) {
    new Promise((resolve, reject) => {
      const query = `DELETE FROM subscriptions WHERE wallet_address = ? AND channel_id = ?`;
      dbConnection.query(query, [address, channelId], (error, results) => {
        if (error) {
          return reject(error);
        }
        console.log(`Removed address: ${address} for channel ID: ${channelId}`);
        resolve();
      });
    });
    throw new Error(
      `Failed to add address: ${response.status} ${response.statusText}`
    );
  }
}

async function removeAddress(address, channelId) {
  new Promise((resolve, reject) => {
    const query = `DELETE FROM subscriptions WHERE wallet_address = ? AND channel_id = ?`;
    dbConnection.query(query, [address, channelId], (error, results) => {
      if (error) {
        return reject(error);
      }
      console.log(`Removed address: ${address} for channel ID: ${channelId}`);
      resolve();
    });
  });
  const api = `https://api.helius.xyz/v0/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${process.env.HELIUS_API_KEY}`;
  const addresses = await listAllAddresses();
  if (!addresses || addresses.length === 0) {
    addresses.push("sample");
  }
  console.log("Addresses:", addresses);
  const response = await fetch(api, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountAddresses: addresses,
      webhookURL: process.env.WEBHOOK_URL,
      transactionTypes: ["SWAP"],
      webhookType: "enhanced",
    }),
  });
  if (!response.ok) {
    new Promise((resolve, reject) => {
      const query = `INSERT INTO subscriptions (wallet_address, channel_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id=id`;
      dbConnection.query(query, [address, channelId], (error, results) => {
        if (error) {
          return reject(error);
        }
        console.log(`Added address: ${address} for channel ID: ${channelId}`);
        resolve();
      });
    });
    throw new Error(
      `Failed to remove address: ${response.status} ${response.statusText}`
    );
  }
}

async function listAllAddresses() {
  return new Promise((resolve, reject) => {
    const query = `SELECT wallet_address FROM subscriptions`;
    dbConnection.query(query, (error, results) => {
      if (error) {
        return reject(error);
      }
      const addresses = results.map((row) => row.wallet_address);
      resolve(addresses);
    });
  });
}

async function listAddresses(channelId) {
  return new Promise((resolve, reject) => {
    const query = `SELECT wallet_address FROM subscriptions WHERE channel_id = ?`;
    dbConnection.query(query, [channelId], (error, results) => {
      if (error) {
        return reject(error);
      }
      const addresses = results.map((row) => row.wallet_address);
      resolve(addresses);
    });
  });
}

async function listChannels(walletAddress) {
  return new Promise((resolve, reject) => {
    const query = `SELECT channel_id FROM subscriptions WHERE wallet_address = ?`;
    dbConnection.query(query, [walletAddress], (error, results) => {
      if (error) {
        return reject(error);
      }
      const channels = results.map((row) => row.channel_id);
      resolve(channels);
    });
  });
}

const sendDiscordNotification = async (
  walletAddress,
  description,
  transactionSignature
) => {
  await sendDiscordWebhook(description, transactionSignature);
  await sendDiscordMessage(walletAddress, description, transactionSignature);
};

const sendDiscordWebhook = async (description, transactionSignature) => {
  const message = {
    embeds: [
      {
        title: "Swap Alert", // This will be the title of the embed
        color: 3066993, // This is a hex color for the embed
        description: description, // The swap description will go here
        fields: [
          // Fields are inline key-value pairs
          {
            name: "Tx:", // Name of the field
            value: `\`${transactionSignature}\``, // Value of the field, formatted as inline code
            inline: false, // Set to false if you want this to appear as a separate line
          },
        ],
        footer: {
          text: "Powered by @code_to_crypto",
          // icon_url: "http://url-to-your-icon.png" // You can also add an icon here
        },
        timestamp: new Date().toISOString(),
      },
    ],
    // content: content,
  };

  try {
    await axios.post(process.env.DISCORD_WEBHOOK_URL, message);
  } catch (error) {
    console.error("Failed to send Discord notification:", error);
  }
};

const sendDiscordMessage = async (
  walletAddress,
  description,
  transactionSignature
) => {
  const channels = await listChannels(walletAddress);
  if (!channels || channels.length === 0)
    return console.error("Channel not found!");

  const message = {
    embeds: [
      {
        title: "Swap Alert",
        color: 3066993,
        description: description,
        fields: [
          {
            name: "Tx:",
            value: `\`${transactionSignature}\``,
            inline: false,
          },
        ],
        footer: { text: "Powered by @code_to_crypto" },
        timestamp: new Date(),
      },
    ],
  };

  channels.forEach(async (channelId) => {
    try {
      const channel = await client.channels.fetch(channelId);
      await channel.send(message);
    } catch (error) {
      console.error("Failed to send Discord notification:", error);
    }
  });
};

function handleWebhookMessage(messageObj) {
  if (!messageObj || messageObj.length === 0) {
    console.error("No messages in the transaction");
    return;
  }
  messageObj.forEach((message) => {
    const wallet = message.feePayer;
    if (!wallet) {
      console.error("No wallet found in the transaction");
      return;
    }
    console.log("Processing message:", message);
    if (message.type !== "SWAP" || message.transactionError !== null) {
      console.error("Not a swap transaction or transaction error");
      return;
    }
    if (message.description) {
      const description = message.description;
      console.log("Sending Discord notification:", description);
      sendDiscordNotification(wallet, description, message.signature);
      return;
    }
    if (message.events.swap) {
      const swap = message.events.swap;
      if (
        (swap.nativeInput ||
          (swap.tokenInputs && swap.tokenInputs.length > 0)) &&
        (swap.nativeOutput ||
          (swap.tokenOutputs && swap.tokenOutputs.length > 0))
      ) {
        let description = "";
        if (swap.nativeInput) {
          description += `${swap.nativeInput.account} swapped ${
            swap.nativeInput.amount / LAMPORTS_PER_SOL
          } SOL for `;
        } else if (swap.tokenInputs && swap.tokenInputs.length > 0) {
          description += `${swap.tokenInputs[0].userAccount} swapped ${
            swap.tokenInputs[0].rawTokenAmount.tokenAmount /
            10 ** swap.tokenInputs[0].rawTokenAmount.decimals
          } of \`${swap.tokenInputs[0].mint}\` for `;
        }

        if (swap.nativeOutput) {
          description += `${swap.nativeOutput.account} SOL`;
        } else if (swap.tokenOutputs && swap.tokenOutputs.length > 0) {
          description += `${
            swap.tokenOutputs[0].rawTokenAmount.tokenAmount /
            10 ** swap.tokenOutputs[0].rawTokenAmount.decimals
          } of \`${swap.tokenOutputs[0].mint}\``;
        }

        console.log("Sending Discord notification:", description);
        sendDiscordNotification(wallet, description, message.signature);
        return;
      }
    }
    if (message.tokenTransfers) {
      const tokenTransfers = message.tokenTransfers;
      if (tokenTransfers.length === 2) {
        sourceTransfer = tokenTransfers[0];
        destinationTransfer = tokenTransfers[1];
        const description = `${sourceTransfer.fromUserAccount} swapped ${sourceTransfer.tokenAmount} of \`${sourceTransfer.mint}\` for ${destinationTransfer.tokenAmount} of \`${destinationTransfer.mint}\``;
        console.log("Sending Discord notification:", description);
        sendDiscordNotification(wallet, description, message.signature);
        return;
      }
    }
  });
}

// Route to handle POST requests
app.post("/webhook", (req, res) => {
  console.log("Received webhook:", JSON.stringify(req.body, null, 2));
  handleWebhookMessage(req.body);
  res.status(200).send("Webhook received!");
});

// Start the server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith("!") || message.author.bot) return;
  console.log("Received command:", message.content);
  const channel = message.channel.id;
  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  const createEmbed = (title, description, color = 3066993) => ({
    embeds: [
      {
        title: title,
        description: description,
        color: color,
        footer: {
          text: "Powered by @code_to_crypto",
          // icon_url: "http://url-to-your-icon.png" // Uncomment to use an icon
        },
        timestamp: new Date(),
      },
    ],
  });

  try {
    if (command === "add") {
      if (!args.length) {
        message.channel.send(
          createEmbed("Error", "Please provide an address!", 0xff0000)
        );
        return;
      }
      await addAddress(args[0], channel);
      message.channel.send(
        createEmbed("Success", `Address \`${args[0]}\` added successfully!`)
      );
    } else if (command === "remove") {
      if (!args.length) {
        message.channel.send(
          createEmbed("Error", "Please provide an address!", 0xff0000)
        );
        return;
      }
      const addresses = await listAddresses(channel);
      if (!addresses || !addresses.includes(args[0])) {
        message.channel.send(
          createEmbed("Error", `Address \`${args[0]}\` not found!`, 0xff0000)
        );
        return;
      }
      await removeAddress(args[0], channel);
      message.channel.send(
        createEmbed("Success", `Address \`${args[0]}\` removed successfully!`)
      );
    } else if (command === "list") {
      const addresses = await listAddresses(channel);
      message.channel.send(
        createEmbed(
          "Addresses List",
          `\`\`\`${addresses.join("\n") || " "}\`\`\``
        )
      );
    } else if (command === "help") {
      message.channel.send(
        createEmbed(
          "Help",
          "Commands:\n\n!add <address>\n!remove <address>\n!list\n!help"
        )
      );
    } else {
      message.channel.send(
        createEmbed(
          "Error",
          "Invalid command! Use !help for a list of commands.",
          0xff0000
        )
      );
    }
  } catch (error) {
    message.channel.send(
      createEmbed("Error", "An error occurred: " + error.message, 0xff0000)
    );
  }
});
