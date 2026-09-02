# Kick slash command inventory

Research date: 2026-09-02

## Overview

Kick describes its [chat command reference](https://help.kick.com/en/articles/7112979-kick-chat-commands) as the complete list of commands available on Kick. The page contains 23 command names and 29 syntax variants. Typing `/` in Kick's first-party composer shows the commands available to the current user.

The reference contains no general viewer commands. Every listed command requires the current user to be the channel owner, a channel moderator, or a Kick Partner who owns the channel.

Kick's Public API does not document slash-command parsing. [`POST /public/v1/chat`](https://docs.kick.com/apis/chat.md) accepts message content and sends a chat message as a user or bot. Its contract does not say that content beginning with `/` invokes a command. StreamFusion must not treat a successful chat-message response as proof that Kick executed a command.

Use a structured Public API endpoint where Kick documents an equivalent action. Open Kick's first-party channel UI for the remaining commands. This keeps unsupported commands visible without reporting a sent chat line as a successful moderation or channel change.

## Permissions

Kick defines three permission groups in the command reference:

| Permission group | Meaning |
| --- | --- |
| Channel owner and moderator | The channel owner and moderators for that channel can use the command. |
| Channel owner | Only the streamer who owns the channel can use the command. |
| Partner channel owner | Only a Kick Partner who owns the channel can use the command. |

The complete command reference grants `/subonly` only to the channel owner. Kick's broader [moderation guide](https://help.kick.com/en/articles/7109164-how-to-moderate-your-kick-chat) says moderators can enable subscriber-only mode. These official pages conflict. Command discovery should follow the command reference and show `/subonly` only to the channel owner until Kick resolves the discrepancy.

## Moderation actions

| Command | Native syntax | Permission | Native effect | Public implementation |
| --- | --- | --- | --- | --- |
| `/ban` | `/ban <username> <reason>` | Channel owner and moderator | Permanently bans the user from the channel. | Public API with limits. Resolve the username to a user ID, then call `POST /public/v1/moderation/bans` without `duration`. The API limits `reason` to 100 characters. |
| `/unban` | `/unban <username>` | Channel owner and moderator | Removes a ban or an active timeout. | Public API. Resolve the username to a user ID, then call `DELETE /public/v1/moderation/bans`. |
| `/timeout` | `/timeout <username> <time> [reason]` | Channel owner and moderator | Stops the user from chatting for the supplied number of seconds. | Public API with a unit mismatch. The moderation API accepts `duration` in whole minutes from 1 through 10,080. Native command input is seconds. Only values divisible by 60 can be represented exactly. The API limits `reason` to 100 characters. |
| `/clear` | `/clear` | Channel owner and moderator | Clears all current chat messages. | First-party UI. The Public API can delete one message by ID, but it documents no clear-all operation. |
| `/mod` | `/mod <username>` | Channel owner | Gives the user the moderator role. | First-party UI. The Public API documents no moderator-role mutation. |
| `/unmod` | `/unmod <username>` | Channel owner | Removes the moderator role. | First-party UI. The Public API documents no moderator-role mutation. |
| `/user` | `/user <username>` | Channel owner and moderator | Displays user information. | First-party UI. `GET /public/v1/users` looks up users by numeric ID, not username, and does not document the native moderation card. |

The timeout table in the command reference omits a reason parameter. The example on the same page and Kick's moderation guide both use `/timeout <username> <time> <reason>`. StreamFusion should accept an optional trailing reason while keeping username and time required.

Kick documents bans, timeouts, and unbans in the [Moderation API](https://docs.kick.com/apis/moderation.md). These operations require the `moderation:ban` scope. Username resolution is a separate integration concern because the [Users API](https://docs.kick.com/apis/users.md) accepts user IDs only.

## Chat modes

| Command | Native syntax | Permission | Native effect | Public implementation |
| --- | --- | --- | --- | --- |
| `/slow` | `/slow on <seconds>` | Channel owner and moderator | Enables slow mode with the supplied delay. | First-party UI. The Public API documents no chat-settings endpoint. |
| `/slow` | `/slow off` | Channel owner and moderator | Disables slow mode. | First-party UI. |
| `/followonly` | `/followonly on` | Channel owner and moderator | Restricts chat to followers. | First-party UI. The command has no argument for minimum follow age. |
| `/followonly` | `/followonly off` | Channel owner and moderator | Disables follower-only chat. | First-party UI. |
| `/subonly` | `/subonly on` | Channel owner | Restricts chat to subscribers. | First-party UI. |
| `/subonly` | `/subonly off` | Channel owner | Disables subscriber-only chat. | First-party UI. |
| `/emoteonly` | `/emoteonly on` | Channel owner and moderator | Restricts messages to emotes. | First-party UI. |
| `/emoteonly` | `/emoteonly off` | Channel owner and moderator | Disables emote-only chat. | First-party UI. |

Kick states that moderators are not affected by these chat modes. The [Public API index](https://docs.kick.com/llms.txt) and [OAuth scope list](https://docs.kick.com/getting-started/scopes.md) contain no chat-settings endpoint or chat-settings scope.

## Stream management

| Command | Native syntax | Permission | Native effect | Public implementation |
| --- | --- | --- | --- | --- |
| `/title` | `/title <new title>` | Channel owner and moderator | Sets the current stream title. | Public API for the authenticated channel owner. `PATCH /public/v1/channels` accepts `stream_title` with `channel:write`. The endpoint has no target broadcaster parameter, so the public contract does not reproduce a moderator changing another user's channel. |
| `/category` | `/category` | Channel owner and moderator | Opens category selection and changes the stream category. | Public API for the authenticated channel owner. Search `GET /public/v2/categories`, then pass the selected `category_id` to `PATCH /public/v1/channels`. The public contract does not document moderator access to another user's channel. |
| `/raid` | `/raid` | Channel owner | Opens the raid workflow and redirects viewers after confirmation. | First-party UI. The Public API documents no raid endpoint. |

The [Channels API](https://docs.kick.com/apis/channels.md) supports `stream_title` and `category_id` updates with `channel:write`. The [Categories API](https://docs.kick.com/apis/categories.md) supports category search. Neither API documents the role elevation that lets a moderator change another broadcaster's stream in Kick's own UI.

Kick's [raid guide](https://help.kick.com/en/articles/14994663-collaborating-with-other-streamers-on-kick) confirms that `/raid` starts the first-party selection and confirmation workflow. The source channel must have at least five viewers. The command reference limits a channel to two raids in 24 hours.

## User management

| Command | Native syntax | Permission | Native effect | Public implementation |
| --- | --- | --- | --- | --- |
| `/og` | `/og <username>` | Channel owner | Gives the user an OG badge. | First-party UI. The Public API documents no OG-role mutation. |
| `/unog` | `/unog <username>` | Channel owner | Removes the user's OG badge. | First-party UI. |
| `/vip` | `/vip <username>` | Channel owner | Gives the user a VIP badge. | First-party UI. The Public API documents no VIP-role mutation. |
| `/unvip` | `/unvip <username>` | Channel owner | Removes the user's VIP badge. | First-party UI. |

## Engagement

| Command | Native syntax | Permission | Native effect | Public implementation |
| --- | --- | --- | --- | --- |
| `/poll` | `/poll` | Channel owner and moderator | Opens poll creation. | First-party UI. The Public API documents no poll endpoint. |
| `/polldelete` | `/polldelete` | Channel owner and moderator | Deletes the active poll. | First-party UI. |
| `/prediction` | `/prediction` | Channel owner and moderator | Opens prediction creation or management. | First-party UI. The Public API documents no prediction endpoint. |

Kick's [prediction guide](https://help.kick.com/en/articles/11182854-guide-to-predictions-for-streamers) confirms that `/prediction` opens a setup modal when no prediction is active. If a prediction is active, it opens management controls. A moderator who participated in that prediction cannot manage it.

## Kick Partner commands

| Command | Native syntax | Permission | Native effect | Public implementation |
| --- | --- | --- | --- | --- |
| `/multi` | `/multi on` | Partner channel owner | Enables the Multistreaming toggle. | First-party UI. The Public API documents no Partner Multistreaming endpoint. |
| `/multi` | `/multi off` | Partner channel owner | Disables the Multistreaming toggle. | First-party UI. |
| `/kpp` | `/kpp on` | Partner channel owner | Enables Kick Partner Program income. | First-party UI. The Public API documents no Partner income endpoint. |
| `/kpp` | `/kpp off` | Partner channel owner | Disables Kick Partner Program income. | First-party UI. |

Kick's [Multistreaming guide](https://help.kick.com/en/articles/11091744-multistreaming-on-the-kick-partner-program) confirms the `/multi on` and `/multi off` forms. The guide warns that a Partner must enable Multistreaming while broadcasting to another long-form platform. The command reference says `/kpp` controls Partner Program income for content such as sleeping streams and watch parties.

## Public API execution matrix

| Execution class | Commands | Required scope or action |
| --- | --- | --- |
| Structured Public API | `/ban`, `/unban` | `moderation:ban` |
| Structured Public API with native behavior limits | `/timeout` | `moderation:ban`. Convert only exact whole-minute durations or use the first-party UI. |
| Structured Public API for the channel owner's token | `/title`, `/category` | `channel:write`. Category selection also uses the Categories API. |
| First-party UI | `/clear`, `/mod`, `/unmod`, `/user`, `/slow`, `/followonly`, `/subonly`, `/emoteonly`, `/raid`, `/og`, `/unog`, `/vip`, `/unvip`, `/poll`, `/polldelete`, `/prediction`, `/multi`, `/kpp` | Open the Kick channel or dashboard workflow. Do not send the raw command through the message API and infer success. |

## StreamFusion implementation constraints

1. Discover commands from the current channel role. Show only owner commands to the channel owner and Partner commands to a Partner channel owner.
2. Parse each command locally. Do not pass raw slash text to `POST /public/v1/chat` as an execution mechanism.
3. Use semantic operations for `/ban`, `/unban`, and `/timeout`. `/title` and `/category` may use the Public API only after the app has the channel owner's `channel:write` scope and a category selection flow. Until then, open Kick's first-party workflow.
4. Resolve usernames before moderation calls. Kick's public user lookup accepts IDs only, so use trusted channel chat identity data or a documented identifier source.
5. Reject timeout seconds that the minute-based Public API cannot represent exactly. A rounded timeout changes the moderator's requested punishment.
6. Open Kick's first-party workflow for commands without a documented Public API equivalent. Do not report success before Kick confirms the action.
7. Restore the original draft when parsing, authorization, API execution, or first-party navigation fails.

## Verification status

This inventory contains all 23 command names and all 29 syntax variants in Kick's complete command reference dated July 9, 2026. The execution classifications use Kick's current Public API index, endpoint schemas, and OAuth scopes. They do not rely on undocumented website endpoints or observed private network calls.

Live role and Partner checks remain necessary. Kick filters the first-party command list by the signed-in user's authority and channel state. A release check should use controlled moderator, channel owner, and Partner channel owner accounts.
