import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { Client, GatewayIntentBits } from "discord.js";

dotenv.config();
const app = express();
const PORT = 3000;

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

let ADDRESSES = [];
let CHANNEL_ID = "";

async function addAddress(address) {
  const api = `https://api.helius.xyz/v0/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${process.env.HELIUS_API_KEY}`;
  const response = await fetch(api, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountAddresses: [...ADDRESSES, address],
      webhookURL: process.env.WEBHOOK_URL,
      transactionTypes: ["SWAP"],
      webhookType: "enhanced",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to add address: ${response.status} ${response.statusText}`
    );
  }
  ADDRESSES.push(address);
  console.log(`Added address: ${address}`);
}

async function removeAddress(address) {
  const api = `https://api.helius.xyz/v0/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${process.env.HELIUS_API_KEY}`;
  const newAddresses = ADDRESSES.filter((addr) => addr !== address);
  if (newAddresses.length === 0) {
    newAddresses.push("sample");
  }
  const response = await fetch(api, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accountAddresses: newAddresses,
      webhookURL: process.env.WEBHOOK_URL,
      transactionTypes: ["SWAP"],
      webhookType: "enhanced",
    }),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to remove address: ${response.status} ${response.statusText}`
    );
  }
  ADDRESSES = ADDRESSES.filter((addr) => addr !== address);
  console.log(`Removed address: ${address}`);
}

async function listAddresses() {
  // const api = `https://api.helius.xyz/v0/webhooks/${process.env.HELIUS_WEBHOOK_ID}?api-key=${process.env.HELIUS_API_KEY}`;
  // const response = await fetch(api, {
  //   method: "GET",
  //   headers: {
  //     "Content-Type": "application/json",
  //   },
  // });
  // if (!response.ok) {
  //   throw new Error(`Failed to add address: ${response.statusText}`);
  // }
  // const json = await response.json();
  // return json["accountAddresses"];
  return ADDRESSES;
}

const sendDiscordNotification = async (description, transactionSignature) => {
  await sendDiscordWebhook(description, transactionSignature);
  await sendDiscordMessage(description, transactionSignature);
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

const sendDiscordMessage = async (description, transactionSignature) => {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return console.error("Channel not found!");
  //if (channels.length === 0) return console.error("Channel not found!");

  // channels.forEach(async (channel) => {
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

  try {
    await channel.send(message);
  } catch (error) {
    console.error("Failed to send Discord notification:", error);
  }
  // });
};

function handleWebhookMessage(messageObj) {
  if (!messageObj || messageObj.length === 0) {
    console.error("No messages in the transaction");
    return;
  }
  messageObj.forEach((message) => {
    console.log("Processing message:", message);
    if (message.type !== "SWAP" || message.transactionError !== null) {
      console.error("Not a swap transaction or transaction error");
      return;
    }
    if (message.description) {
      const description = message.description;
      console.log("Sending Discord notification:", description);
      sendDiscordNotification(description, message.signature);
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
        sendDiscordNotification(description, message.signature);
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
        sendDiscordNotification(description, message.signature);
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
  CHANNEL_ID = message.channel.id;
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
      await addAddress(args[0], message);
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
      if (!ADDRESSES.includes(args[0])) {
        message.channel.send(
          createEmbed("Error", `Address \`${args[0]}\` not found!`, 0xff0000)
        );
        return;
      }
      await removeAddress(args[0]);
      message.channel.send(
        createEmbed("Success", `Address \`${args[0]}\` removed successfully!`)
      );
    } else if (command === "list") {
      const addresses = await listAddresses();
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
