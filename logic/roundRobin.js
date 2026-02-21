// logic/roundRobin.js

function generateRoundRobin(players) {
    const matches = [];

    for (let i = 0; i < players.length; i++) {
        for (let j = i + 1; j < players.length; j++) {
            matches.push({
                player1: players[i].name,
                player2: players[j].name,
                level: players[i].level
            });
        }
    }

    return matches;
}

function getNextThursday(startDate = new Date()) {
    const date = new Date(startDate);
    const day = date.getDay();
    const daysUntilThursday = (4 - day + 7) % 7 || 7;
    date.setDate(date.getDate() + daysUntilThursday);
    return date;
}

function scheduleMatches(matches, startDate = new Date()) {
    const firstThursday = getNextThursday(startDate);

    return matches.map((match, index) => {
        const matchDate = new Date(firstThursday);
        matchDate.setDate(firstThursday.getDate() + index * 7);

        return {
            ...match,
            date: matchDate.toLocaleDateString("en-CA")
        };
    });
}


module.exports = {
    generateRoundRobin,
    scheduleMatches
};
