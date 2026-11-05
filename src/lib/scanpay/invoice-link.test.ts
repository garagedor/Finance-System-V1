import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planInvoiceLinks, type LinkInvoice, type LinkJob } from './invoice-link';

const inv = (n: string, o: Partial<LinkInvoice> = {}): LinkInvoice => ({ invoiceNumber: n, team: 1, createdAt: '2026-10-20T15:00:00Z', amount: '3013', tipAmount: '0', customerName: 'Danny', status: 'PAID', memberId: 'm-ofek', ...o });
const job = (id: string, o: Partial<LinkJob> = {}): LinkJob => ({ _id: id, date: '2026-10-20', clientName: 'Danny', tech: 'Ofek', totalPaidCard: '3013', tipsCard: 0, ...o });
const names = new Map([['m-ofek', 'Ofek Elisha']]);
const none = new Map<string, Set<string>>();

test('one job fits on date, amount, name and tech → linked', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1')], jobs: [job('a'), job('b', { totalPaidCard: 500 })], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 1);
  assert.equal(r.links[0].job._id, 'a');
  assert.deepEqual(r.links[0].evidence, ['date', 'amount', 'name', 'tech']);
});

test('a job that already has an invoice number is never used', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1')], jobs: [job('a', { invoiceNumber: 'IN-9' })], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 0);
});

test('the invoice already on a job is skipped', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1')], jobs: [job('a', { invoiceNumber: 'IN-1' })], memberTechs: none, memberNames: names });
  assert.equal(r.skipped.alreadyOnJob, 1);
});

test('two equal jobs → a suggestion, not a link', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1', { customerName: null })], jobs: [job('a', { clientName: null }), job('b', { clientName: null })], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 0);
  assert.equal(r.suggestions[0].reason, 'ambiguous');
});

test('date + amount only (nothing confirms) → suggestion', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1', { customerName: null, memberId: null })], jobs: [job('a', { clientName: null })], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 0);
  assert.equal(r.suggestions[0].reason, 'weak');
});

test('a different technician blocks the link', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1')], jobs: [job('a', { tech: 'Yaniv' })], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 0);
  assert.equal(r.suggestions[0].reason, 'tech-mismatch');
});

test('two invoices claiming one job → both left for a person', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1'), inv('IN-2')], jobs: [job('a')], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 0);
  assert.equal(r.suggestions.filter((s) => s.reason === 'shared-job').length, 2);
});

test('name contradicts → not a candidate; unpaid invoices ignored', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1', { customerName: 'Robert Smith' }), inv('IN-2', { status: 'UNPAID' })], jobs: [job('a')], memberTechs: none, memberNames: names });
  assert.equal(r.links.length + r.suggestions.length, 0);
});

test('tech learned from earlier linked jobs wins over the name', () => {
  const learned = new Map([['m-ofek', new Set(['Ofek E'])]]);
  const r = planInvoiceLinks({ invoices: [inv('IN-1')], jobs: [job('a', { tech: 'Ofek E' })], memberTechs: learned, memberNames: names });
  assert.equal(r.links.length, 1);
});

test('no job with the amount, but the same customer nearby → "amount differs" suggestion', () => {
  const r = planInvoiceLinks({ invoices: [inv('IN-1')], jobs: [job('a', { totalPaidCard: 2800 })], memberTechs: none, memberNames: names });
  assert.equal(r.links.length, 0);
  assert.equal(r.suggestions[0].reason, 'amount-differs');
  assert.equal(r.suggestions[0].candidates[0].job._id, 'a');
});
