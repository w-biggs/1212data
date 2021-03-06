/**
 * Gets the game's info from Reddit and outputs the data needed for the database
 */
const Team = require('../models/teams/team.model');
const Coach = require('../models/coach.model');
const fetchGamePlays = require('./fetchGamePlays');
const { fixTeamHtmlEntities, fetchGameJson } = require('./utils');

/**
 * Get stats from the game
 * @param {String} postBody The post's body
 */
const parseGameStats = function parseGameStats(postBody) {
  const homeStats = {
    passYds: 0,
    rushYds: 0,
    interceptions: 0,
    fumbles: 0,
    fieldGoals: {
      attempts: 0,
      makes: 0,
    },
    timeOfPossession: 0,
    timeoutsRemaining: 3,
    score: {
      quarters: [],
      final: 0,
    },
  };
  let homeMins = 0;
  let homeSecs = 0;
  const awayStats = {
    passYds: 0,
    rushYds: 0,
    interceptions: 0,
    fumbles: 0,
    fieldGoals: {
      attempts: 0,
      makes: 0,
    },
    timeOfPossession: 0,
    timeoutsRemaining: 3,
    score: {
      quarters: [],
      final: 0,
    },
  };
  let awayMins = 0;
  let awaySecs = 0;

  const statsRegex = /:-:\n([-0-9]+) yards\|([-0-9]+) yards\|.+\|([0-9]+)\|([0-9]+)\|([0-9]+)\/([0-9]+)\|([0-9]+):([0-9]+)\|([0-9]+)/g;
  const awayStatsMatch = statsRegex.exec(postBody);
  const homeStatsMatch = statsRegex.exec(postBody);

  [, awayStats.passYds, awayStats.rushYds, awayStats.interceptions, awayStats.fumbles,
    awayStats.fieldGoals.makes, awayStats.fieldGoals.attempts, awayMins, awaySecs,
    awayStats.timeoutsRemaining] = awayStatsMatch.map((match) => parseInt(match, 10));
  awayStats.timeOfPossession = (awayMins * 60) + awaySecs;

  [, homeStats.passYds, homeStats.rushYds, homeStats.interceptions, homeStats.fumbles,
    homeStats.fieldGoals.makes, homeStats.fieldGoals.attempts, homeMins, homeSecs,
    homeStats.timeoutsRemaining] = homeStatsMatch.map((match) => parseInt(match, 10));
  homeStats.timeOfPossession = (homeMins * 60) + homeSecs;

  const scoreRegex = /\|([0-9|]+)\|\*\*([0-9]+)/g;
  const homeScoreMatch = scoreRegex.exec(postBody);
  const awayScoreMatch = scoreRegex.exec(postBody);
  homeStats.score.quarters = homeScoreMatch[1].split('|').map((q) => parseInt(q, 10));
  homeStats.score.final = parseInt(homeScoreMatch[2], 10);
  awayStats.score.quarters = awayScoreMatch[1].split('|').map((q) => parseInt(q, 10));
  awayStats.score.final = parseInt(awayScoreMatch[2], 10);

  return {
    homeStats,
    awayStats,
  };
};

const parseGameJson = function parseGameJson(gameJson, gameId) {
  const postBody = gameJson.selftext;

  const gameObj = {
    gameId,
    startTime: gameJson.created_utc,
    endTime: gameJson.edited,
    homeTeam: {
      team: '',
      coaches: [],
      stats: {
        passYds: 0,
        rushYds: 0,
        interceptions: 0,
        fumbles: 0,
        fieldGoals: {
          attempts: 0,
          makes: 0,
        },
        timeOfPossession: 0,
        timeoutsRemaining: 3,
        score: [],
      },
    },
    awayTeam: {
      team: '',
      coaches: [],
      stats: {
        passYds: 0,
        rushYds: 0,
        interceptions: 0,
        fumbles: 0,
        fieldGoals: {
          attempts: 0,
          makes: 0,
        },
        timeOfPossession: 0,
        timeoutsRemaining: 3,
        score: [],
      },
    },
    plays: [],
    live: !(postBody.indexOf('Game complete') >= 0),
    status: {},
  };

  let homeCoach = '';
  let awayCoach = '';

  /**
   * Benchmarked this - multiple small regexes is twice as fast.
   */
  const teamInfoRegex = /Defense\n.*\n\[(.+)\].+\|(\/u\/.+)\|(.+)\|(.+)\n\[(.+)\].+\|(\/u\/.+)\|(.+)\|(.+)/gm;
  const teamInfoMatch = teamInfoRegex.exec(postBody);
  if (teamInfoMatch) {
    [, gameObj.awayTeam.team, awayCoach, gameObj.awayTeam.offense,
      gameObj.awayTeam.defense,
      gameObj.homeTeam.team, homeCoach, gameObj.homeTeam.offense,
      gameObj.homeTeam.defense] = teamInfoMatch;
    
    gameObj.homeTeam.coaches = homeCoach.split(' and ').map((coach) => ({ name: coach, plays: 0 }));
    gameObj.awayTeam.coaches = awayCoach.split(' and ').map((coach) => ({ name: coach, plays: 0 }));
  } else {
    // Filters out things like "RESTARTED - NEXT SCORE WINS South Dakota"
    const oldTeamInfoRegex = /\[GAME THREAD\] (?:#[0-9]+ )?(?:\(.+\) )?(?:.+[A-Z]{4,} )?(.+) @ (?:#[0-9]+ )?(?:\(.+\) )?(?:.+[A-Z]{4,} )?(.+)/;
    const oldTeamInfoMatch = oldTeamInfoRegex.exec(gameJson.title);
    [, gameObj.awayTeam.team, gameObj.homeTeam.team] = oldTeamInfoMatch;
  }

  // Fix HTML entities
  gameObj.homeTeam.team = fixTeamHtmlEntities(gameObj.homeTeam.team);
  gameObj.awayTeam.team = fixTeamHtmlEntities(gameObj.awayTeam.team);

  let playsLink = '';
  const playsLinkRegex = /\[Plays\]\((.+)\)/gm;
  const playsLinkMatch = playsLinkRegex.exec(postBody);
  if (playsLinkMatch) {
    [, playsLink] = playsLinkMatch;
  }

  const gameStats = parseGameStats(postBody);
  gameObj.homeTeam.stats = gameStats.homeStats;
  gameObj.awayTeam.stats = gameStats.awayStats;

  // Status
  const statusRegex = /([0-9]+):([0-9]+)\|([0-9]+)\|([0-9]+).+ (?:&|&amp;) ([0-9]+|goal)\|([-0-9]+)(?: \[(.+?)\])?.+?\[(.+?)\]/;
  const statusMatch = statusRegex.exec(postBody);
  const [, min, sec, quarter, down, distance, location, side, possession] = statusMatch;
  const fixedLocation = Math.max(location, 0);

  gameObj.status.clock = (parseInt(min, 10) * 60) + parseInt(sec, 10);
  gameObj.status.quarter = parseInt(quarter, 10);
  gameObj.status.down = parseInt(down, 10);
  gameObj.status.distance = distance === 'goal' ? parseInt(fixedLocation, 10) : parseInt(distance, 10);
  gameObj.status.yardLine = side && (fixTeamHtmlEntities(side) === fixTeamHtmlEntities(possession))
    ? parseInt(fixedLocation, 10)
    : 100 - parseInt(fixedLocation, 10);
  gameObj.status.homeOffense = (fixTeamHtmlEntities(possession) === gameObj.homeTeam.team);

  return fetchGamePlays(playsLink, gameJson, gameObj.homeTeam, gameObj.awayTeam)
    .catch((error) => {
      throw error;
    })
    .then((response) => {
      const { plays, teamCoaches } = response;
      gameObj.plays = plays.length === 0 ? null : plays;

      gameObj.homeTeam.coaches = teamCoaches.home;
      gameObj.awayTeam.coaches = teamCoaches.away;
      return gameObj;
    });
};

/**
 * Get a team's ref from their name.
 * @param {String} teamName The name of the team to get the ref for.
 */
const getTeamRef = function getTeamRefFromName(teamName) {
  return Team.findOne({ name: teamName })
    .catch((error) => {
      throw error;
    })
    .then((team) => {
      if (!team) {
        throw new Error(`Team ${teamName} not found in database.`);
      }
      return team._id;
    });
};

/**
 * Get a coach's ref from their username.
 * @param {String} username The username of the coach to get the ref for.
 */
const getCoachRef = function getCoachRefFromUsername(username) {
  const plainUsername = username.replace('/u/', '');
  return Coach.findOne({ username: plainUsername })
    .catch((error) => {
      throw error;
    })
    .then((coach) => {
      if (!coach) {
        console.log(`Coach ${plainUsername} not found in database.`);
        const newCoach = new Coach({ username: plainUsername });
        return newCoach.save()
          .then((savedCoach) => savedCoach._id);
      }
      return coach._id;
    });
};

/**
 * Fill refs for plays.
 * @param {Object} gameObj The game to fill play refs for.
 */
const fillPlayRefs = function fillPlayCoachRefs(gameObj) {
  const filledGameObj = gameObj;
  const coaches = [];

  for (let i = 0; i < gameObj.awayTeam.coaches.length; i += 1) {
    coaches.push(gameObj.awayTeam.coaches[i]);
  }

  for (let i = 0; i < gameObj.homeTeam.coaches.length; i += 1) {
    coaches.push(gameObj.homeTeam.coaches[i]);
  }

  if (gameObj.plays) {
    const filledPlays = [];
    for (let i = 0; i < gameObj.plays.length; i += 1) {
      const play = gameObj.plays[i];
  
      /**
       * Offense coach
       */
      let foundOffCoach = false;
      for (let j = 0; j < coaches.length; j += 1) {
        const coach = coaches[j];
        if (coach.name === play.offense.coach) {
          play.offense.coach = coach.coach;
          foundOffCoach = true;
        }
      }
      if (!foundOffCoach) {
        console.log(coaches);
        throw new Error(`Play has coach not in gameObj - ${play.offense.coach}`);
      }
  
      /**
       * Defense coach(es)
       */
      for (let j = 0; j < play.defense.coach.length; j += 1) {
        let foundDefCoach = false;
        for (let k = 0; k < coaches.length; k += 1) {
          const coach = coaches[k];
          if (coach.name === play.defense.coach[j]) {
            play.defense.coach[j] = coach.coach;
            foundDefCoach = true;
          }
        }
        if (!foundDefCoach) {
          console.log(coaches);
          throw new Error(`Play has coach not in gameObj - ${play.defense.coach[j]}`);
        }
      }
  
      filledPlays.push(play);
    }

    filledGameObj.plays = filledPlays;
  }

  for (let i = 0; i < gameObj.awayTeam.coaches.length; i += 1) {
    delete filledGameObj.awayTeam.coaches[i].name;
  }

  for (let i = 0; i < gameObj.homeTeam.coaches.length; i += 1) {
    delete filledGameObj.homeTeam.coaches[i].name;
  }

  return filledGameObj;
};

/**
 * Add object refs to teams' coaches
 * @param {Array} coaches Array of coach names and play #s
 */
const fillCoachRefs = function fillCoachRefs(coaches) {
  const coachPromises = [];
  for (let i = 0; i < coaches.length; i += 1) {
    const coach = coaches[i];
    coachPromises.push(
      getCoachRef(coach.name)
        .then((coachId) => ({
          coach: coachId,
          ...coach,
        })),
    );
  }
  return Promise.all(coachPromises);
};

/**
 * Add object refs to necessary fields in this game.
 * @param {Object} parsedGame The game to fill refs for
 */
const fillGameRefs = function fillGameRefs(parsedGame) {
  const gameObj = parsedGame;

  return Promise.all([
    getTeamRef(gameObj.homeTeam.team),
    getTeamRef(gameObj.awayTeam.team),
    fillCoachRefs(gameObj.homeTeam.coaches),
    fillCoachRefs(gameObj.awayTeam.coaches),
  ])
    .catch((error) => {
      throw error;
    })
    .then((filledVals) => {
      [
        gameObj.homeTeam.team,
        gameObj.awayTeam.team,
        gameObj.homeTeam.coaches,
        gameObj.awayTeam.coaches,
      ] = filledVals;
      return fillPlayRefs(gameObj);
    });
};

/**
 * Fetch a game's information and parse it
 * @param {String} gameId The game's Reddit post ID
 * @param {Boolean} expand Whether to expand replies
 * @param {Boolean} limit Whether to rate limit
 */
// eslint-disable-next-line no-unused-vars
const fetchGameInfo = async function fetchAndParseGameInfo(gameId, expand = true, limit = true) {
  const response = await fetchGameJson(gameId);
  // console.log(`Fetched ${gameId}`);
  const parsedGame = await parseGameJson(response, gameId);
  return fillGameRefs(parsedGame);
};

module.exports = fetchGameInfo;
