import test from 'node:test';import assert from 'node:assert/strict';import {courseFromContext} from '../src/index-v1.1.1.js';
test('Mainichi Okan official comma-formatted header wins over prior-run 1600',()=>{assert.deepEqual(courseFromContext('第77回毎日王冠 コース：1,800メートル（芝・左） 前走 1600芝','第77回毎日王冠'),{surface:'芝',distance:1800})});
test('Kyoto Daishoten official header parses 2400 turf',()=>{assert.deepEqual(courseFromContext('第61回京都大賞典 コース：2,400メートル（芝・右 外） 前走 3200芝','第61回京都大賞典'),{surface:'芝',distance:2400})});
