export const minorCards = [
    "ace", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "page", "knight", "queen", "king"
];

export const minorSuits = [
    "pentacles", "swords", "wands", "cups"
];

export const minorArcana = (card: string, suit: string) => {
    return `${card}_of_${suit}`;
};

export const majorArcana = [
    "the_fool", "the_magician", "high_priestess", "the_empress", "the_emperor", "the_hierophant", "the_lovers",
    "the_chariot", "strength", "the_hermit", "wheel_of_fortune", "justice", "hanged_man", "death", "temperance",
    "the_devil", "the_tower", "the_star", "the_moon", "the_sun", "judgment", "the_world"
]

export function allCards() {
    let results = [];
    for (let suit of minorSuits) {
        for (let card of minorCards) {
            results.push(minorArcana(card, suit));
        }
    }
    for (let card of majorArcana) {
        results.push(card);
    }
    return results;
}

export const totalCards = minorCards.length * minorSuits.length + majorArcana.length;