import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskNumbers, numberFault, restoreNumbers } from './numbers.mjs';

test('a figure with a magnitude is masked with it and written back in full', () => {
  const { masked, values } = maskNumbers('who number about 20 millions or so; about 15 millions', 'hi');
  assert.equal(masked, 'who number about [0] or so; about [1]');
  assert.deepEqual(values, ['2,00,00,000', '1,50,00,000']);
});

test('a date is one token, written back in the target language', () => {
  const { masked, values } = maskNumbers('March 3,1930. The first batch of 125 men and over 8,000', 'hi');
  assert.equal(masked, '[0]. The first batch of [1] men and over [2]');
  assert.deepEqual(values, ['3 मार्च 1930', '125', '8,000']);
  assert.deepEqual(maskNumbers('held on the 25th December 1927.', 'te').values, ['25 డిసెంబర్, 1927']);
  assert.deepEqual(maskNumbers('in March 1927 at Mahad', 'mr').values, ['मार्च 1927']);
  assert.equal(maskNumbers('on or about the 1st of April 1936 !', 'hi').masked, 'on or about the [0] !');
});

test('an ordinal and a list marker stay in the text', () => {
  assert.equal(maskNumbers('the 19th and 20th instants', 'hi').masked, 'the 19th and 20th instants');
  assert.equal(maskNumbers('(1) to make and (2) to enforce', 'hi').masked, '(1) to make and (2) to enforce');
});

test('a token the engine dropped refuses the block, and a repeated one is filled', () => {
  const mask = { values: ['125', '1930'], footnote: null };
  assert.equal(restoreNumbers('[0] पुरुष, [1]', mask), '125 पुरुष, 1930');
  assert.equal(restoreNumbers('पुरुष, [1]', mask), null);
  assert.equal(restoreNumbers('[0] [0] [1]', mask), '125 125 1930');
});

test('a footnote reference is lifted off the end and put back', () => {
  const mask = maskNumbers('the conference concluded for the day.” 1', 'hi');
  assert.equal(mask.masked, 'the conference concluded for the day.”');
  assert.equal(restoreNumbers('सम्मेलन समाप्त हुआ।', mask), 'सम्मेलन समाप्त हुआ। 1');
});

test('a magnitude the engine attached to a figure is a fault, and a lookalike is not', () => {
  const source = 'who number about 20 millions';
  const mask = maskNumbers(source, 'hi');
  assert.equal(numberFault(source, 'hi', restoreNumbers('लगभग [0]', mask)), null);
  assert.match(numberFault(source, 'hi', restoreNumbers('लगभग [0] लाखों', mask)), /magnitude/);
  assert.equal(numberFault('whose aim was', 'te', 'దీని లక్ష్యం'), null);
});

test('a figure left in the text must survive, in either digit set', () => {
  assert.equal(numberFault('on the 19th instant', 'hi', '१९ तारीख को'), null);
  assert.match(numberFault('on the 19th instant', 'hi', 'उस तारीख को'), /lost 19/);
  assert.equal(numberFault('(1) to make', 'hi', '(i) बनाने के लिए'), null);
});
