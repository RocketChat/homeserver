import { expect, test } from 'bun:test';

import { EventID } from '../types/_common';
import { PersistentEventV9 } from './v9';
import { EventID } from '../types/_common';

test('event without origin', async () => {
	const event = new PersistentEventV9(
		{
			type: 'm.room.member',
			auth_events: [
				'$gbm6Tyhskcai9hxHXAh7RCoDlrwl1GFf4pWd1P6ELM4',
				'$g5tzeYmxj1ulmzQv07uDZZztxHhiebe5WH7Gg7npwd0',
				'$LrAkyyTl5j9Pda7DWo8_epIKa0Q0r6Epw2UHQnSIukI',
				'$HFVJ9Ub_2je7bL2LM9uiK1HBYZA0nYDevMT3e-8s_5I',
			] as EventID[],
			content: {
				avatar_url: 'mxc://matrix.org/MyC00lAvatar',
				displayname: '@diego:rc1',
				membership: 'invite',
			},
			depth: 8,
			hashes: {
				sha256: 'AVnMNw6L0jAq69eJUfDRYfmwRVrkh3qKmAStKSvscsI',
			},
			origin_server_ts: 1756156853485,
			prev_events: ['$HhSZakbJx7fbn5zMxn7QQHCsRFHjEMRa3OIQdCdR2oc' as EventID],
			room_id: '!cIgsCPRFcbabBKlTRk:hs2',
			sender: '@admin:hs2',
			unsigned: {
				age: 5,
				invite_room_state: [],
			},
			signatures: {},
			state_key: '@diego:rc1',
		},
		'10',
	);

	expect(event.eventId).toBe(
		'$iCA3OWE1EGtPVWIyGudgmifuJcIluQw88FuK_gd0FpM' as EventID,
	);
});
