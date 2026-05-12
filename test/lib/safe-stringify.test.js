const { expect } = require('chai');
const safeStringify = require('../../telegrambot/lib/safe-stringify');

describe('lib/safe-stringify', function () {
    it('stringifies plain objects normally', function () {
        const out = safeStringify({ a: 1, b: 'two' });
        expect(out).to.include('"a": 1');
        expect(out).to.include('"b": "two"');
    });

    it('honours the indent argument', function () {
        const out = safeStringify({ a: 1 }, 2);
        // 2-space indent => one leading space less than the default 4
        expect(out.split('\n')[1].startsWith('  "a"')).to.equal(true);
    });

    it('passes through primitives', function () {
        expect(safeStringify(42)).to.equal('42');
        expect(safeStringify('hi')).to.equal('"hi"');
        expect(safeStringify(null)).to.equal('null');
        expect(safeStringify(true)).to.equal('true');
    });

    it('substitutes "[Circular]" for a self-referential object', function () {
        const a = { name: 'a' };
        a.self = a;
        const out = safeStringify(a);
        expect(out).to.include('"[Circular]"');
        expect(out).to.include('"name": "a"');
    });

    it('substitutes "[Circular]" for nested back-references', function () {
        const root = { kids: [] };
        const child = { parent: root };
        root.kids.push(child);
        const out = safeStringify(root);
        // root is referenced again via child.parent -> placeholder
        expect(out).to.include('"[Circular]"');
        expect(out).to.include('"kids"');
    });

    it('returns valid JSON for circular input (string round-trips through JSON.parse)', function () {
        const a = { name: 'a' };
        a.self = a;
        const parsed = JSON.parse(safeStringify(a));
        expect(parsed.name).to.equal('a');
        expect(parsed.self).to.equal('[Circular]');
    });

    it('does not mutate the input object shape', function () {
        const a = { name: 'a' };
        a.self = a;
        const keysBefore = Object.keys(a).slice();
        safeStringify(a);
        expect(Object.keys(a)).to.deep.equal(keysBefore);
        expect(a.self).to.equal(a); // self-reference preserved
    });

    it('reuses keys when the same object appears as a sibling, not just a circular parent', function () {
        // Telegram payload pattern: msg.originalMessage.chat.pinned_message.chat === msg.chat
        const sharedChat = { id: 123, type: 'private' };
        const payload = {
            chat: sharedChat,
            pinned_message: { chat: sharedChat, text: 'hi' },
        };
        const out = safeStringify(payload);
        // Replacer fires the first time, then [Circular] on the second visit
        expect(out).to.include('"id": 123');
        expect(out).to.include('"[Circular]"');
    });
});
