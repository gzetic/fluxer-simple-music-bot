import { Client, Events, VoiceChannel } from '@fluxerjs/core';
import { getVoiceManager } from '@fluxerjs/voice';
import youtubedl from 'youtube-dl-exec';
import { spawn } from 'node:child_process';

const token = process.env.FLUXER_BOT_TOKEN;

const YTDLP_COMMAND = 'node_modules/youtube-dl-exec/bin/yt-dlp';

if (!token) {
  console.error("Missing FLUXER_BOT_TOKEN environment variable.");
  process.exit(1);
}

let videoUrl = null;
let looping = false;

let lastChannel = null;

let errCount = 0;

process.on('uncaughtException', async (e) => {
    errCount++;
    console.error(e);
    // often happens when file is in wrong format
    // TODO: ffmpeg transcode
    if (errCount < 3) await client.sendToChannel(lastChannel, "❌ An unexpected error occurred. Try a different track.")
});

// TODO: Add arr for queue

const client = new Client({ 
    intents: 0 
});

const voiceManager = getVoiceManager(client);

try {
    await client.login(process.env.FLUXER_BOT_TOKEN);

    client.on(Events.MessageCreate, async (message) => {
        try {
            console.log(message)
            lastChannel = message.channelId;

            if (message.author.bot) return;

            const args = message.content.split(' ');
            const command = args[0];

            if (command === '/play') {
                const query = message.content.slice(6).trim();
                
                if (!query) {
                    return message.send({ content: "Please provide a song name to search. 🔮🔮" });
                }

                // TODO: check if already in the same vc

                const voiceChannelId = voiceManager.getVoiceChannelId(message.guildId, message.author.id);

                if (!voiceChannelId) {
                    return message.send({ content: "❌ You must be in a voice channel to play music." });
                }

                const channel = client.channels.get(voiceChannelId);
                
                if (!channel || !(channel instanceof VoiceChannel)) {
                    return message.send({ content: "❌ Could not resolve your voice channel." });
                }

                await message.send({ content: `🔎 Searching Youtube for: **${query}**...` });

                try {
                    const searchRes = await youtubedl(`ytsearch1:${query}`, {
                        dumpSingleJson: true,
                        noWarnings: true,
                        flatPlaylist: true,
                    }, { timeout: 15000 });

                    const video = searchRes.entries ? searchRes.entries[0] : searchRes;

                    if (!video) {
                        return message.send({ content: "❌ No video found." });
                    }

                    videoUrl = video.webpage_url || video.url;

                    await message.send({ 
                        content: `🎵 Singing **${video.title}** \n🔗 ${video.url}` 
                    });

                    playAudio(videoUrl, channel, message);

                    errCount = 0;
                } catch (e) {
                    console.error("Play error:", e);
                    message.send({ content: "❌ An error occurred while trying to play the track." });
                }
            }

            if (command === '/stop') {
                const connection = voiceManager.getConnection(message.guildId);
                if (connection) {
                    connection.stop();
                    message.send({ content: "⏹️ Stopping playback." });
                }
                else {
                    message.send({ content: "❌ I am not currently in a voice channel." });
                }
            }

            if (command === '/leave') {
                const connection = voiceManager.getConnection(message.guildId);

                if (connection) {
                    connection.stop();
                    voiceManager.leave(message.guildId);
                    message.send({ content: "👋 **Leaving channel**." });
                }
                else {
                    message.send({ content: "❌ I am not currently in a voice channel." });
                }
            }

            // if (command === '/loop') {
            //     if (videoUrl && !looping) {
            //         looping = true;
            //         message.send({ content: "🔁 Loop enabled." });
            //     }
            //     else if (looping) {
            //         looping = false;
            //         message.send({ content: "🔁 Loop disabled." });
            //     }
            //     else {
            //         message.send({ content: "❌ No song to loop." });
            //     }
            // }

            if (command === '/help') {
                message.send({ content: `Commands:
*/play <song name>*: to play a song from Youtube
*/stop*: to stop music playback
*/leave*: Get the bot to leave the voice channel
*/help*: to display this list of commands` });
            }
        }
        catch (e) {
            console.error("Error:", e);
            await message.send({ content: "❌ An unexpected error occurred." })
        }
    });

}
catch (e) {

}

async function playAudio(videoUrl, channel, message) {
    try {
        if (!videoUrl) {
            return message.send({ content: "❌ Could not extract audio stream." });
        }

        const args = [
            videoUrl,
            '-o', '-',
            '-q',
            '--no-warnings',
            '-f', 'bestaudio[ext=webm][acodec=opus]/bestaudio',
            '-r', '100K',
        ];

        const child = spawn(YTDLP_COMMAND, args, {
            stdio: ['ignore', 'pipe', 'ignore']
        });

        const connection = await voiceManager.join(channel);

        child.stdout.on('error', (err) => {
            console.error('Stream Error:', err);
            if (!connection.destroyed) connection.stop();
        });

        child.on('close', (code) => {
            if (code !== 0 && code !== null) {
                console.log(`yt-dlp process exited with code ${code}`);
            }
        });

        await connection.play(child.stdout);

        if (connection.currentStream) {
            connection.currentStream.once("end", () => 
                { if (looping) playAudio(videoUrl, channel, message); }
            );
        }
    }
    catch (e) {
        console.error("Play error:", e);
        message.send({ content: "❌ An error occurred while trying to play the track." });
    }
}