import { assign, createActor, setup, and, not, or } from "xstate";
import { speechstate } from "speechstate";
import { createBrowserInspector } from "@statelyai/inspect";
import { KEY, NLU_KEY } from "./azure.js";

/*
General notes/documentation:

Skip to const instructions for explanation of the game itself. These instructions are also available in-game.

There are several states with "Intermediate" in their name. These are arguably superfluous from a state logic perspective,
but they serve as a solution to what seems to go on behind the scenes when xstate transitions when speak actions/speak_complete events
are involved. If there's a speak actions on a transition (not on an entry action or similar) xstate will send to the new state,
let the system finish speaking, then take the next state's speak_complete transitions, even if there's an entry speak action in the new
state, effectively skipping the new speak action. So there seems to need to be an intermediate state if there are going to be any speaking
on a transition. The solution works regardless of whether the first speak action is in the old state or the intermediate state, as long as
that intermediate state exists.

Finally, the game was designed for the user to go back and forth a lot with the helper intents ("what do we know", "suspects", etc),
but the higher difficulty modes require this to the point of tedium, so for testing I recommend staying at the default (easy) mode.
Specifically for your testing purposes, I also log the random solution as well as the suspects, once those are generated.
This is obviously not part of the game, but having to do the deduction every time if you just want to test certain states seems annoying.
*/ 
const inspector = createBrowserInspector();

const azureCredentials = {
  endpoint:
    "https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issuetoken",
  key: KEY,
};

const azureLanguageCredentials = {
  endpoint:
  "https://language-resource-ds1.cognitiveservices.azure.com/language/:analyze-conversations?api-version=2022-10-01-preview" /** your Azure CLU prediction URL */,
  key: NLU_KEY,
  deploymentName: "project",
  projectName: "final_project",
};

const settings = {
  azureLanguageCredentials: azureLanguageCredentials,
  azureCredentials: azureCredentials,
  asrDefaultCompleteTimeout: 0,
  //increased noinput time since "being silent" is something the player can deliberately do to go back to the main part of the game
  //and I want to avoid this happening by accident. Of course it might still happen.
  asrDefaultNoInputTimeout: 8000,
  locale: "en-US",
  ttsDefaultVoice: "en-US-NancyNeural",
};

//Kinds of evidence that can be requested. Once a kind of evidence has been requested, it can't be requested again (system will just reprompt)
//A non-demo version of the game would have many more
let evidence = ["cause of death", "time of death", "motive", "state of the victim's clothes", "hint on body part",
"social relationship between victim and culprit", "weather"]


//see documentation for mappingPrio function for purpose of this array.
let meansPrio = [
  "cause of death", "hint on body"
]

//cluePrio turned out not necessary since its elements are in complementary distribution with meansPrio
//and is thus captured by an "else" condition in mappingPrio function

/*let cluePrio = [
  "time of death", "motive", "state of the victim's clothes", "social relationship between victim and culprit", "weather"
]*/


//meansMapping and clueMapping maps each possible item to a set of kinds of evidence, which in turn map to information about
//that piece of evidence.
const meansMapping = {
  scissors: {solution: "scissors", "cause of death": "loss of blood", "hint on body part": "all over the body"},
  chainsaw: {solution: "chainsaw", "cause of death": "loss of blood", "hint on body part": "on the hand...which is on the table over there"},
  "ice skates": {solution: "ice skates", "cause of death": "loss of blood", "hint on body part": "almost looks like it could have been an accident, the way that throat was cut", weather: "cold"},
  "knife and fork": {solution: "knife and fork", "cause of death": "loss of blood", "social relationship between victim and culprit": "very, very close. Especially now after the murder",
  "hint on body part": "all over, especially the missing pieces"},
  belt: {solution: "belt", "cause of death": "suffocation", "hint on body part": "marks around the neck", },
  "plastic bag": {solution: "plastic bag", "cause of death": "suffocation", "hint on body part": "some piece of material seems stuck in the victim's mouth"},
  drowning: {solution: "drowning", "cause of death": "suffocation", "hint on body part": "the hair is a mess"},
  scarf: {solution: "scarf", "cause of death": "suffocation", "hint on body part": "marks around the neck", weather: "cold"},
  wine: {solution: "wine", "cause of death": "poison or disease", "social relationship between victim and culprit": "they were close once, but only one of them wanted to rekindle this evening", motive: "spurned love", "hint on body part": "nothing, really, but we should wait for the autopsy"},
  scorpion: {solution: "scorpion", "cause of death": "poison or disease", "social relationship between victim and culprit": "one-sided, but the culprit finally got the victim's attention with a peculiar murder weapon",
  "hint on body part": "just a small mark on the leg", weather: "warm and humid"},
  injection: {solution: "injection", "cause of death": "poison or disease",
  "hint on body part": "in the arm fold"},
  starvation: {solution: "starvation", "cause of death": "poison or disease", "social relationship between victim and culprit": "clearly the culprit felt something strongly, if they wanted to drag it out like this",
  "hint on body part": "body seems brittle"},
  "steel tube": {solution: "steel tube", "cause of death": "blunt trauma", },
  trophy: {solution: "trophy", "cause of death": "blunt trauma", "social relationship between victim and culprit": "rivals", motive: "jealously", 
  },
  crutch: {solution: "crutch", "cause of death": "blunt trauma", "social relationship between victim and culprit": "strangers until an accident",
  motive: "revenge", "hint on body part": "a leg was broken"},
  punch: {solution: "punch", "cause of death": "blunt trauma", "hint on body part": "some teeth are gone"},
};

const clueMapping = {
"take-out food": {solution: "take-out food", location: "kitchen", "social relationship between victim and culprit": "they hang out quite often",
"time of death": "evening", weather: "pouring rain", "state of the victim's clothes": "messy"},
  
book: {solution: "book", location: "school", "social relationship between victim and culprit": "classmates, perhaps?",
  "time of death": "afternoon", "state of the victim's clothes": "tidy"},
  
underwear: {solution: "underwear", location: "bedroom", "social relationship between victim and culprit": "quite close, perhaps even romantically involved",
"time of death": "evening", motive: "spurned love", "state of the victim's clothes": "naked"},
  
"office supplies": {solution: "office supplies", location: "office", "social relationship between victim and culprit": "one was the boss of the other",
"time of death": "middle of the day", motive: "that they had just had enough", weather: "sunny, but the victim didn't get to enjoy it", "state of the victim's clothes": "orderly"},
  
diary: {solution: "diary", location: "bedroom", "social relationship between victim and culprit": "one-sided", "time of death": "just before bedtime, it seems",
motive: "unrequited love", "state of the victim's clothes": "pyjamas"},

dust: {solution: "dust",location: "storeroom", "social relationship between victim and culprit": "one where the victim would show up even to this secluded place",
"time of death": "working hours", weather: "dry", "state of the victim's clothes": "messy"},
 
juice: {solution: "juice", location: "kitchen", "time of death": "morning", "state of the victim's clothes": "messy"},
  
snacks: {solution: "snacks", location: "kitchen", "time of death": "evening", motive: "they were smacking too loud", "state of the victim's clothes": "messy"}, 
  
dictionary: {solution: "dictionary", location: "school", "social relationship between victim and culprit": "student and teacher", "time of death": "just before an exam, perhaps?",
motive: "frustration", weather: "sohl eh ah doh",//this orthography sort of makes the system pronounce "soleado", Spanish for "sunny", as a hint for "dictionary". Seems a bit overkill
//to add Spanish TTS for one word that occurs in 1/16 games IF the user asks a particular question
"state of the victim's clothes": "neat"},
  
toothpicks: {solution: "toothpicks",location: "restaurant", "time of death": "evening", motive: "it's just so distracting, why can't they just get rid of it?"},
  
"clothes hanger": {solution: "clothes hanger", location: "bedroom", "time of death": "morning or evening", motive: "fashionable jealousy", "state of the victim's clothes": "very orderly"},
  
menu: {solution: "menu", location: "restaurant", "social relationship between victim and culprit": "close enough for a date, it seems", "time of death": "evening",
motive: "that sitting across from each other, the reasons they broke up must have come flooding back", "state of the victim's clothes": "fancy"},
  
coffee: {solution: "coffee", location: "kitchen", "time of death": "morning", motive: "that they weren't a morning person", weather: "too dark, too early", "state of the victim's clothes": "stained"},
  
"oil stain": {solution: "oil stain", location: "storeroom", "time of death": "working hours", motive: "victim messed up the fancy overalls", "state of the victim's clothes": "stained"},
  
"electronic speaker": {solution: "electronic speaker", location: "living room", "time of death": "late evening", "social relationship between victim and culprit": "neighbours",
motive: "they took matters into their own hands after the housing association did not take the appropriate steps", weather: "thunderous, say witnesses, but we're not sure this checks out",
"state of the victim's clothes": "casual"},

jewelry: {solution: "jewelry", location: "bedroom", "time of death": "just as they were heading out to an event", motive: "that they might've wanted something gifted back", "state of the victim's clothes": "elegant"},

};

const queryLines = [
  "What piece of evidence do you think will best solve this case? What about", "What do you want to focus on? Perhaps", 
  "What do you think will be most relevant? Maybe",  "What evidence do you think is most important? May I suggest",
  "Which proof do you think best pins down the murderer? I think perhaps"
];
const solveLines = [
  "Let's solve this case!", "Let's catch that killer!", "I know you've got it!", "We'll get them now!"
];

const instructions = {
  beginner: `You're a detective tasked with solving a murder.
          Your detective partner will call you to the scene of the crime, the location of which will be your first piece of evidence.
          There will be a number of suspects depending on the difficulty mode.
          Each suspect will be represented by a list of potential means of murder and a list of incriminating clues.
          You will be told these lists at the start of the game.
          To win the game, you must guess the randomly selected combination of weapon and clue.
          There will always be exactly one weapon and one clue, and the selection is always made from the same suspect's lists.          
          At most points in the game, you will be free to take one of the following actions:
          1. Ask about some piece of evidence. Your partner will have some suggestions for you, but you can always ask about something that was suggested at an earlier stage of the game or something you remember from a previous case.
          For example, if the murder weapon was "scissors" and you ask about the "cause of death", you'll get "loss of blood".
          You can ask for 4 such pieces of evidence, then you will be pressed to try to solve the case. Note that you'll be asking about evidence that will help you pin down the weapon and clue, not about those items directly.
          2. You can also try to solve the case before you are forced to. State that you want to solve the case. When prompted, guess a weapon and a clue an see if you're right!
          After two guesses the case goes cold and you lose.
          You can earn a better score by managing with fewer pieces of evidence or fewer guesses.
          3. Ask about the suspects. This will give you the lists of means and clues tied to each suspect.
          4. Ask what evidence you have so far. This will recap the evidence you've already received.
          Asking about the suspects and old evidence is just to help you remember and does not impede your score.
          Note that any given piece of evidence might fit multiple weapons or clues, so you need to triangulate the most likely combination.
          Any score above 0 is a success, and the highest possible is 6.
          5. Ask for instructions. You will get an abbreviated version of these instructions which summarise the main game actions.

          To get back to the main part of the game, you just need to stay silent.
          
          Good luck!`,
  midgame: `To win the game, you must guess the correct combination of one means and one clue tied to the same suspect.
            You can take the following actions at most points in the game:
            1. When prompted, ask about a piece of evidence, for example "cause of death". Your partner will suggest options.
            2. Ask to solve the case, after which you will be prompted to guess at a solution to the game.
            3. Ask about the suspects. You will be given the lists of means and clues tied to each suspect.
            4. Ask what evidence you know so far. This will recap the answers you have already received, including the location you learned at the start of the game.
            You only need to stay silent at any point after the game starts to get back to the main part of the game, which varies depending on if you have guesses left.
            Good luck!

            `};


const confirmationLines = {
  "cause of death": `Are you asking about what caused the death?`, "time of death": `Are you asking about when the crime occurred?`, 
  "motive": `Are you asking about the motive of the killer?`, "state of the victim's clothes": `Are you asking about the state of the victim's clothes?`,
  "hint on body part": `Are you asking if there was some hint on a specific body part?`, "social relationship between victim and culprit": `Are you asking what relationship might exist between those involved?`,
  "weather": `Are you asking what the weather was like at the time of the crime?`, "solve the case": `Would you like to try to solve the case?`,
  "asking about suspects": `Would you like to know what clues and means are tied to each suspect?`, "asking for evidence": `Are you trying to hear what evidence we have already confirmed?`,
  "asking for instructions": `Would you like me to summarise the game instructions?`
};

//some context-helper variables. Sometimes (usually when interacting with javascript functions) I had some issues with 
//context storage, so I instead had these function mutate these global variables. The system uses a mix of these and 
//context storage. Specific documentation in mutation functions.
let suspects
let solutionMappings
let finalAnswer
let currentEvidence
let currentQuery = ""
let whatWeKnow = []
let lastConfirmation = undefined
let confirmationCount = 0
let confirmationTopic



function mappingPrio(evidenceStr) {
  /*Whenever the player requests a piece of evidence, the system checks if that kind of evidence is in
  meansPrio (or implicitly in cluePrio, but since they are complementary distribution, this is only done by "else" condition).
  an example of the logic this function implements is this:
  
  assume the requested evidence type is "motive"
  check which prio array motive is in (cluePrio)
  check if solutionMappings.clue has a property "motive"
  if yes, tell user that the motive was solutionMappings.clue.
  if no, check if solutionMappings.means has a property "motive",
  if yes, tell user,
  if no tell the user that motive is probably not that relevant, which is useful information in itself

  of course, the "telling" is not performed by the function, but by speech/xstate

  the purpose of this semantics is to have a deduction process that is deterministic but still variable from game to game by making
  certain information only given if it's not blocked by the other item in the solution.
  partially from https://www.w3schools.com/js/js_if_else.asp
  */
    let primMap
    let primKey
    let secMap
    let secKey
  
    if (meansPrio.indexOf(evidenceStr) >=0 ) {
        primMap = meansMapping
        primKey = "means"
        secMap = clueMapping
        secKey = "clue"
    } else {
        primMap = clueMapping
        primKey = "clue"
        secMap = meansMapping
        secKey = "means"
    }
  
    if (Object.keys(primMap[solutionMappings[primKey].solution]).indexOf(evidenceStr) >=0) {
      currentEvidence = solutionMappings[primKey][evidenceStr]
    } else if (Object.keys(secMap[solutionMappings[secKey].solution]).indexOf(evidenceStr) >=0) {
      currentEvidence = solutionMappings[secKey][evidenceStr]
    } else {
      currentEvidence = "probably not that relevant"
    }
    
  };



//----------------------------
//stores values that help system know how to perform given certain circumstances.
//prevents the need for many addtional states

function updateConfTopic(topic) {
  confirmationTopic = topic
};

function updateConfirmation(bool) {

  if (bool === true) {
    lastConfirmation = true
  } else if (bool === false) {
    lastConfirmation = false
  } else {
    lastConfirmation = undefined
  }
};

function confCountIncrement() {
    confirmationCount +=1
  };

function confReset() {
  confirmationCount = 0
  lastConfirmation = undefined
};
function ConfTopicReset() {
  confirmationTopic = undefined
};

function updateQuery(evidenceQuery) {
  currentQuery = evidenceQuery
};
//---------------------------



function removeEvidence(intent) {
  //from Justin Liu at
  //https://stackoverflow.com/questions/5767325/how-can-i-remove-a-specific-item-from-an-array-in-javascript
  //Removes evidence from evidence variable after user has already recieved this information
  //Makes the system not suggest it
  const index = evidence.indexOf(intent);
  if (index > -1) { 
  evidence.splice(index, 1); 
}
};


function shuffleArray(arr) {
  //shuffles input array. Randomises the game scenario and some utterances
  for (let i = arr.length - 1; i > 0; i--) {
      let j = Math.floor(Math.random() * (i + 1));
      let temp = arr[i];
      arr[i] = arr[j];
      arr[j] = temp;
  }
};

function randomiseSuspects(meansObj, cluesObj, suspectNum, suspectSize) {
  //Randomises the suspects for the scenario accommodates for variable
  //difficulty settings
  let means = Object.keys(meansObj)
  let clues = Object.keys(cluesObj)

  shuffleArray(means)
  shuffleArray(clues)
  let randomSuspects = []
  
  let counter = 0
  while (counter < suspectNum*suspectSize) {
    randomSuspects.push([means.slice(counter, counter+suspectSize), clues.slice(counter, counter+suspectSize)])
    counter +=suspectSize
  }
  suspects = randomSuspects
  };
  
  function randomIndex(suspectSize) {
    return Math.floor(Math.random() * suspectSize)
  };
  
  function randomiseSolution(suspectsInp, suspectNum, suspectSize) {
    //randomises the solution for the scenario
    //takes the already randomly configured suspects and picks a solution that
    //is exactly one means and one clue from the same suspect.
    const culpritNum = Math.floor(Math.random() * suspectNum)
    const meansSolution = suspectsInp[culpritNum][0][randomIndex(suspectSize)]
    const clueSolution = suspectsInp[culpritNum][1][randomIndex(suspectSize)]
    const randomSolution = {means: meansMapping[meansSolution], clue: clueMapping[clueSolution]}
    solutionMappings = randomSolution
    finalAnswer = [meansSolution, clueSolution]
  
  };


  function guessValidity(ent0, ent1, suspectNum) {
    //checks whether a guess is a valid solution so that the player does not waste
    //guesses on ones that could not be correct in the first place.
    let count = 0
    while (count < suspectNum) {
      if (((suspects[count][0].indexOf(ent0) >= 0) & (suspects[count][1].indexOf(ent1) >= 0)) | ((suspects[count][0].indexOf(ent1) >= 0) & (suspects[count][1].indexOf(ent0) >= 0))) {
        return true
        
      }
      count +=1
    }
    return false
  };

  function suspectsUtterance(suspectNum) {
    //generates the utterance that will be given when user asks about the suspects.
    //requires a function implementation since the utterance will have to vary depending on difficulty mode
    let count = 0
    let utt = ``
    while (count < suspectNum) {
      utt = `${utt} Suspect ${count+1} is tied to these means:
      ${suspects[count][0]}
      and these clues:
      ${suspects[count][1]}
      `
      count +=1
    }
    return utt
  };

const dmMachine = setup({
  actions: {
      configureSuspects: ({ context }) => randomiseSuspects(context.means, context.clues, context.suspectNum, context.suspectSize),
      generateSolution: ({ context }) => randomiseSolution(suspects, context.suspectNum, context.suspectSize),
      queryCounterIncrement: assign({ queryCounter: ({ context }) => context.queryCounter +=1 }),
      solveCounterIncrement: assign({ solveCounter: ({ context }) => context.solveCounter +=1 }),
      shuffleArr: ({ }, params) => shuffleArray(params),
      trimEvidence: ({ }) => removeEvidence(currentQuery),
      queryAnswer: ({ event }) => mappingPrio(event.nluValue.topIntent),
      updateCurrentQuery: ({ event }) => updateQuery(event.nluValue.topIntent),
      knowledgeUpdate: ({ }) => whatWeKnow.push(`${currentQuery} was ${currentEvidence}`),
      locationUpdate: ({ }) => whatWeKnow.push(`location was ${solutionMappings.clue.location}`),
      confirmationRepetition: ({ }) => confCountIncrement(),
      affirmConfirmation: ({}) =>  updateConfirmation(true),
      negateConfirmation: ({}) => updateConfirmation(false),
      confirmationDone: ({}) => confReset(),
      storeGuess: assign({ guess: ({ event }) => [event.nluValue.entities[0].category, event.nluValue.entities[1].category] }),
      guessReset: assign({ guess: ({ }) => false }),
      updateConfirmationTopic: ({ event }) => updateConfTopic(event.nluValue.topIntent),
      //confirmationTopicReset: ({}) => ConfTopicReset(),
      updateConfirmationASR: assign({ confirmationASR: ({ event }) => event.value[0].utterance }),
      //updateSolutionConfirmationTopic: assign({ confirmationTopic: ({ context }) => context.guess }),
      generateSuspectsUtterance: assign({ suspectsUtterance: ({ context }) => suspectsUtterance(context.suspectNum) })
  },
  guards: {
    lowIntentConfidence: ({ event }, ) => event.nluValue.intents[0].confidenceScore < 0.7,
    lowEntityConfidence: ({ event }, ) => event.nluValue.entities[0].confidenceScore < 0.7,
    yes: ({ event }) => event.nluValue.entities[0].category === "affirmative",
    no: ({ event }) => event.nluValue.entities[0].category === "negative",
    checkEvidence: ({ event }) => evidence.indexOf(event.nluValue.topIntent) >= 0,
    inEvidence: ({ }) => evidence.indexOf(confirmationTopic) >= 0, //context.confT
    noEntities: ({ event }) => event.nluValue.entities.length < 1,
    checkEnt0: ({ context }) => (finalAnswer.indexOf(context.guess[0]) >= 0),
    checkEnt1: ({ context }) => (finalAnswer.indexOf(context.guess[1]) >= 0),
    solutionConfidence: ({ event }) => (event.nluValue.entities[0].confidenceScore + event.nluValue.entities[1].confidenceScore) >=1.4,
    confirmationChecker: ({}) => confirmationCount > 1,
    checkGuessStorage: ({ context }) => context.guess === false,
    checkValidity: ({ event, context }) => guessValidity(event.nluValue.entities[0].category, event.nluValue.entities[1].category, context.suspectNum),
    solutionLength: ({event}) => event.nluValue.entities.length < 2,
    suspectsTop: ({ event }) => event.nluValue.topIntent === "asking about suspects",
    knownTop: ({ event }) => event.nluValue.topIntent === "asking for evidence",
    instructionsTop: ({ event }) => event.nluValue.topIntent === "asking for instructions",
    solveTop: ({ event }) => event.nluValue.topIntent === "solve the case"
  },
}).createMachine({
  context: {
    suspectSize: 2,
    suspectNum: 2,
    means: meansMapping,
    clues: clueMapping,
    queryCounter: 0,
    solveCounter: 0,
    confirmationCount: 0,
    guess: false
  },
  id: "DM",
  initial: "Prepare",

  on: { ASR_NOINPUT:
    {target: "#DM.NoInputIntermediate",
    actions: ({ context }) =>
    context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: `You there detective? Let's focus! `,
      },
    }),
  },
  
  RECOGNISED: [
    {
      guard: "lowIntentConfidence", target: "#DM.Confirmation",
      actions: [
        {type: "updateConfirmationTopic"},
        {type: "updateConfirmationASR"},
      ]
    },
    {
      guard: "solveTop",
      target: "#DM.MainParent.SolveCase",
    },
    {
        guard: "instructionsTop",
         target: "#DM.MidgameInstructions",
  },
  {
    guard: "suspectsTop",
     target: "#DM.Suspects",
},
{
  guard: "knownTop",
   target: "#DM.KnownEvidence", 
},
//Final high-level catch-all guard to avoid crashes.
//Don't think it should come to this (for this reason) since the system is always checking for intents,
//and these always exist (if at low confidence scores)
{target: "#DM.MainParent"}
],
},

  states: {
    Prepare: {
      entry: [
        assign({
          ssRef: ({ spawn }) => spawn(speechstate, { input: settings }),
        }),
        ({ context }) => context.ssRef.send({ type: "PREPARE" }),
      ],
      on: { ASRTTS_READY: "WaitToStart" },
    },
    WaitToStart: {
      on: {
        CLICK: "Welcome",
      },
    },
      Welcome: {
      entry: [
       //State semantics: Brief game introduction, then asks whether the player wants a full introduction. This introduction is more thorough than the one mid-game
       //since the game does require somewhat thorough instructions, but I don't want the midgame instructions to break the pace of the game too much. Affirmative
       //or negative answer do what should be expected from the question. Checks nlu confidence, but only redos the query (instead of confirmation) if the answer
       //is not affirmation/negation or if the confidence is too low. This is because the binary choice of a confirmation does not seem smoother than just redoing
       //a state which already a binary choice.
       //Always exits to GenerateScenario
        ({ context }) => context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: `Welcome to Dialogue Deduction: a game where you are forced by circumstance to work with your dialogue system partner to solve a murder with only your voice.
          Do you want the beginner's instructions?
          `,
        },
      }),
      ],
        on: { SPEAK_COMPLETE: "InstructionsListen" },},
      InstructionsListen: 
        {
          entry: ({ context }) =>
              context.ssRef.send({
                type: "LISTEN",
                value: { nlu: true },
              }),
              on:
              //Lower level asr_noinput since I don't want the general one to apply before the game has begun.
              //From a structure perspective I should have arguably rewired the logic so that the general one is in the MainParent state since it is only
              //there that I want it to apply, but semantically this should be the same.
              {ASR_NOINPUT: "InstrIntermediate",
                RECOGNISED: [
                {guard: or(["noEntities", "lowEntityConfidence"]),
                  target: "InstrIntermediate"},
            {guard: "yes",
                  target: "Instructions",},
            {guard: "no",
          target: "Settings",},
        {target: "InstrIntermediate"}],},},

        InstrIntermediate: {
          entry: ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `I couldn't quite catch a yes or no type of answer. Do you want the beginner's introduction?`,
            },
          }),
          on: { SPEAK_COMPLETE: "#DM.InstructionsListen" },
        },
        
        Instructions: {
          entry: [

             ({ context }) => context.ssRef.send({
             type: "SPEAK",
             value: {
               utterance: `${instructions.beginner}`,
             },
           }),
           ],
             on: { SPEAK_COMPLETE: "Settings" },
        },
        

        Settings: {
          //state semantics from here to just before GenerateScenario:
          //Ask if user wants to change difficulty settings and carry out this request.
          initial: "SettingsQuery",
          states: {
            SettingHist: {type: "history"},

            SettingsQuery: {
              initial: "Query",
              states: {

            Query: {
            entry: [
              ({ context }) => context.ssRef.send({
              type: "SPEAK",
              value: {
                //note: the default difficulty is easy on the deduction and is ideal for testing the system. The game is designed for the player to go back to the
                //memory-helper states here and there, but this might be tedious during testing. Harder difficulties are honestly quite tedious, since there is a
                //lot of information to keep track of, requiring frequent returns to the suspect/old evidence states.
                utterance: `Do you want to change any settings? The default difficulty setting is the easiest: with 2 suspects who both have only 2 means and 2 clues each.`
                
              },
            }),
            ],
              on: { SPEAK_COMPLETE: "Listen" },
          },
          Listen: {
            entry: ({ context }) =>
              context.ssRef.send({
                type: "LISTEN",
                value: { nlu: true },
              }),
              on: {ASR_NOINPUT: {target: "#DM.SettingsIntermediate", actions: ({ context, }) =>         
              context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `I didn't hear anything. Please give a yes or no type of answer.`,
                },
              }),},
              RECOGNISED: [
                {guard: or(["noEntities", "lowEntityConfidence"]),
                  target: "#DM.SettingsIntermediate", actions: ({ context, }) =>         
                  context.ssRef.send({
                    type: "SPEAK",
                    value: {
                      utterance: `I didn't quite catch that. Please give a yes or no type of answer.`,
                    },
                  }),},
                {guard: "yes",
                target: "#DM.Settings.SuspectNum",
          },
          {guard: "no",
                target: "#DM.GenerateScenario",

          },
          {target: "#DM.SettingsIntermediate",
          actions: ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `Please give a yes or no type of answer.`,
            },
          }), },
        ]
      },
    },
  },
},
    
    
    
          SuspectNum: {
            initial: "Query",
            states:{
            Query: {
            entry: 
              ({ context }) => context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `How many suspects do you want in the game? Valid answers are 2, 3, and 4, where higher is more difficult.`,
              },
            }),
            
            on: { SPEAK_COMPLETE: "Listen" },},

            
            
            Listen: {
            entry: ({ context }) =>
            context.ssRef.send({
              type: "LISTEN",
              value: { nlu: true },
            }),
              on: {ASR_NOINPUT: {target: "#DM.SettingsIntermediate", actions: ({ context, }) =>         
              context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `I didn't hear anything.`,
                },
              }),},
              RECOGNISED: [
                {guard: or(["noEntities", "lowEntityConfidence"]),
                  target: "#DM.SettingsIntermediate", actions: ({ context, }) =>         
                  context.ssRef.send({
                    type: "SPEAK",
                    value: {
                      utterance: `I didn't quite catch that.`,
                    },
                  }),},
                {guard: ({ event }) => event.nluValue.entities[0].category === "2", target: "#DM.Settings.SuspectSize"},
                {guard: ({ event }) => event.nluValue.entities[0].category === "3", target: "#DM.Settings.SuspectSize", actions: assign({ suspectNum: ({ }) => 3 }),},
                {guard: ({ event }) => event.nluValue.entities[0].category === "4", target: "#DM.Settings.SuspectSize", actions: assign({ suspectNum: ({ }) => 4 })},
                {target: "#DM.SettingsIntermediate",
          actions: ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `I didn't catch a valid answer.`,
            },
          }), },
              ]}},}},
              
            SuspectSize: {
              initial: "Query",
              states:{
              Query: {
              entry: 
              ({ context }) => context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `How many means and clues do you want per suspect in the game? Valid answers are 2, 3, and 4, where higher is more difficult.`,
              },
            }),
            
            on: { SPEAK_COMPLETE: "SizeListen" },},

            SizeListen: {
            entry: ({ context }) =>
              context.ssRef.send({
                type: "LISTEN",
                value: { nlu: true },
              }),
              on: {ASR_NOINPUT: {target: "#DM.SettingsIntermediate", actions: ({ context, }) =>         
              context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `I didn't hear anything.`,
                },
              }),},
              RECOGNISED: [
                {guard: or(["noEntities", "lowEntityConfidence"]),
                  target: "#DM.SettingsIntermediate", actions: ({ context, }) =>         
                  context.ssRef.send({
                    type: "SPEAK",
                    value: {
                      utterance: `I didn't quite catch that.`,
                    },
                  }),},
                {guard: ({ event }) => event.nluValue.entities[0].category === "2", target: "#DM.GenerateScenario"},
                {guard: ({ event }) => event.nluValue.entities[0].category === "3", target: "#DM.GenerateScenario", actions: assign({ suspectNum: ({ }) => 3 }),},
                {guard: ({ event }) => event.nluValue.entities[0].category === "4", target: "#DM.GenerateScenario", actions: assign({ suspectNum: ({ }) => 4 }),},
                {target: "#DM.SettingsIntermediate",
                actions: ({ context, }) =>         
                context.ssRef.send({
                  type: "SPEAK",
                  value: {
                    utterance: `I didn't catch a valid answer.`,
                  },
                }),}
              ]}},}}
            },
          },
    SettingsIntermediate: {
      on: { SPEAK_COMPLETE: "Settings.SettingHist" },
    },

    GenerateScenario: {
      //Generate scenario based on requested difficulty mode. Nothing after this state can return to here or anywhere earlier
      //(except higher level events which send back to the game part of the machine.)
      always:  {
      target: "Introduction",

      actions: [{         
        type: "configureSuspects",
      },
      {
        type: "generateSolution",
      },
      {type: "generateSuspectsUtterance"},
      //logs some scenario information for the benefit of testers. See beginning of script 
      ({ }) => console.log("Suspects: Each outer array is a suspect. Inner array[0] is means, inner array[1] is clues."),
      ({ }) => console.log(suspects), 
      ({ }) => console.log("Valid guesses: any combination of one means and one clue tied to the same suspect."),
      ({ }) => console.log("Correct solution:", finalAnswer,) 

    ]
  },
},

    Confirmation: {
      //State use: confirms low nlu confidence statements. Generalised to apply to any original state that might transition here.
      //State semantics: aims to get affirmative or negative answer from user. Sends back to original state with true/false boolean depending on
      //affirmative/negative. Original state will have its own specific instructions depending on boolean.
      //Slightly variable execution depending on what is being confirmed. 
      //Transitions to the proper MainParent substate (CentralState or SolveCase depending on game stage) after too many unsuccessful 
      //confirmation attempts.
      initial: "Filter",
      
      states: {

        Filter: {
          always: [{guard: "confirmationChecker", target: "#DM.MainParent"},
                  {guard: "checkGuessStorage", target: "IntentConfirming"},
                  {target: "SolutionConfirming"}]     
        },
        IntentConfirming: {
            entry: 
              ({ context, }) =>         
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `${confirmationLines[confirmationTopic]}?`,
              },
            }),
            on: { SPEAK_COMPLETE: "Listening" },},
        
        SolutionConfirming: {
          entry: [
            ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `Are you trying to solve the case with the following solution:
               ${context.guess[0]} and ${context.guess[1]}?`,
            },
          }),
        ],
          on: { SPEAK_COMPLETE: "Listening" },
        },
        
        Listening: {
          entry: ({ context }) =>
              context.ssRef.send({
                type: "LISTEN",
                value: { nlu: true },
              }),
              on: 
              {RECOGNISED: [
                
                {guard: ({ event }) => event.nluValue.entities.length < 1,
                  target: "ReconfirmIntermediate",},              
                {guard: "yes",
                  target: "#DM.MainParent.MPHist",
              actions:[
                {type: "affirmConfirmation"},
              ],
            },
            {guard: "no",
          target: "NegativeIntermediate",
          actions: 
              {type: "negateConfirmation"},},
            {target: "ReconfirmIntermediate",},
        ],
      },
    },

        ReconfirmIntermediate: {
          entry: [
            {type: "confirmationRepetition"},
          ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `I didn't hear an affirmation or a negation.`,
            },
          }),
        ],
        on: { SPEAK_COMPLETE: "#DM.Confirmation" },
        },

        NegativeIntermediate: {
          entry: ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `I see. I inferred from what I thought I heard, which was 
              ${context.confirmationASR}.`,
            },
          }),
          on: { SPEAK_COMPLETE: "#DM.MainParent.MPHist" },
        },
    },
  },
    NoInputIntermediate: {
      entry: ({ context }) =>
      context.ssRef.send({
      type: "SPEAK",
      value: {
        utterance: `You there detective? Let's focus! `,
      },}),
      on: { SPEAK_COMPLETE: "MainParent" },
  },

  //------------
  //states that can always be requested for information but are never prompted:
  Suspects: {
    //give suspect arrays
    entry: 
      ({ context }) =>
      context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: `${context.suspectsUtterance}`,
        },
      }),
      on: { SPEAK_COMPLETE: "MainParent.MPHist" },
  },

  MidgameInstructions: {
    //give shorter instructions
    entry: 
      ({ context }) =>
      context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: `${instructions.midgame}
          `
        },
      }),
      on: { SPEAK_COMPLETE: "MainParent.MPHist" },
  },

  KnownEvidence: {
    //give information that has already been recieved
    entry: ({ context }) =>
      context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: `What we know so far is that ${whatWeKnow}`,
        },
      }),
     
     on: { SPEAK_COMPLETE: "MainParent.MPHist" },
  },
  //--------------

    Introduction: {
      //Story introduction. Introduces why the game is contrived to be a voice game.
      //Gives first piece of evidence (location) and the suspects.
      entry:[
        {type: "locationUpdate"},
        ({ context }) => context.ssRef.send({
        type: "SPEAK",
        value: {
          utterance: `          
          Hello detective. Sorry to disturb your vacation, but there's been a murder and we need your help!
          Since you can only join by voice message, we have to do the best with the situation.
          I'm at the scene of the crime as we speak, which is the ${solutionMappings.clue.location} at XState Street 18.
          I have taken some notes on the evidence but don't quite know where to start.
          ${context.suspectsUtterance}`,
        },
      }),
    ],
        on: { SPEAK_COMPLETE: "MainParent" },
    },


    MainParent: {
      //most systems funnel the player back here. First to MainParent.CentralState, where user is prompted to ask for evidence,
      //then to MainParent.SolveCase when the maximum amount of evidence has been given
      initial: "CentralState",
      states: {
    
    MPHist: {type: "history"},

    CentralState: {
      initial: "Filter",
      states: {
        Filter: {

          always: [
            {             
              guard: ({ context }) => context.queryCounter > 3,
              target: "OutOfTimeIntermediate",
              actions: ({ context }) => context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `Detective, we have no more time to consider new evidence and must try to finish this!. `,
                },
              }),
            },
            {guard: ({ }) => lastConfirmation === true,
            target: "ConfirmationDisambiguation",
            actions: {type: "confirmationDone"} },
            {target: "PartnerQuery", actions: {type: "confirmationDone"},}
          ],
        },
        ConfirmationDisambiguation: {
          always: [
            {guard: "inEvidence", target: "#DM.MainParent.GiveEvidence"},
            {
              guard: ({ }) => confirmationTopic === "solve the case",
              target: "#DM.MainParent.SolveCase",
            },
            {
                guard: ({ }) => confirmationTopic === "asking for instructions", 
                 target: "#DM.MidgameInstructions", 
          },
          {
            guard: ({ }) => confirmationTopic === "asking about suspects", 
             target: "#DM.Suspects",
        },
        {
          guard: ({ }) => confirmationTopic === "asking for evidence",
           target: "#DM.KnownEvidence",
          
        },
          ],
        },

        OutOfTimeIntermediate: {
          on: { SPEAK_COMPLETE: "#DM.MainParent.SolveCase" },
        },
        PartnerQuery:{
          entry: [
            { type: "shuffleArr", params: evidence },
            { type: "shuffleArr", params: queryLines},
            ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `${queryLines[0]} ${evidence[0]} or ${evidence[1]}`,
              },
            }),
            ],
          on: { SPEAK_COMPLETE: "UserInput" },
        },
        
        UserInput:{
          entry: ({ context }) =>
              context.ssRef.send({
                type: "LISTEN",
                value: { nlu: true },
              }),
              on: 
              {RECOGNISED: [
                //Don't think this guard/transition is necessary since any RECOGNISED event includes all intents, if at low confidence scores. But just in case                
                {guard: ({ event }) => event.nluValue.intents.length < 1,
              target: "#DM.MainParent",
            actions: ({ context }) =>
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `I didn't quite catch your intention there.
                You must ask for a new piece of evidence, ask what we already know, request to solve the case, ask about suspects, or ask for instructions.  
                `
              },
            }),},
                {guard: and(["lowIntentConfidence", "checkEvidence"]),
                  target: "#DM.Confirmation",
              actions:[              
              {type: "queryAnswer" },
              {type: "updateCurrentQuery"},
              {type: "updateConfirmationTopic"},
              {type: "updateConfirmationASR"},
            ]
            },
            {guard: "checkEvidence",
                  target: "#DM.MainParent.GiveEvidence",
              actions:[              
              {type: "queryAnswer" },
              {type: "updateCurrentQuery"},

            ]
            },

        ],},
              
          },
        },
      },

    GiveEvidence: {
      entry: 
        [{type: "trimEvidence" }, {type: "knowledgeUpdate"}, {type: "queryCounterIncrement"},
        ({ context }) =>
        context.ssRef.send({
          type: "SPEAK",
          value: {
            utterance: `The ${currentQuery} was ${currentEvidence}.`   
          },
        }),],
        
      on: { SPEAK_COMPLETE: { target: "#DM.MainParent"},},},

    SolveCase: {
      initial: "Filter",
      states: {
        Filter: {
          always: [
            {guard: ({ }) => lastConfirmation === true,
            target: "ConfirmationDisambiguation",
            actions: {type: "confirmationDone"} },
            

          {target: "PartnerQuery", actions: "guessReset"}]
        },

        ConfirmationDisambiguation: {
          always: [
            {guard: ({ }) => confirmationTopic === "asking for instructions", target: "#DM.MidgameInstructions"},
          {guard: ({ }) => confirmationTopic === "asking about suspects", target: "#DM.Suspects",},
        {guard: ({ }) => confirmationTopic === "asking for evidence", target: "#DM.KnownEvidence", },
        {
          target: "ResolveGuess",
        },
      ]
    },
        PartnerQuery: {
      entry:[
        { type: "shuffleArr", params: solveLines },
        ({ context }) =>
        context.ssRef.send({
          type: "SPEAK",
          value: {
            utterance: `${solveLines[0]}. Which clue and means of murder do you want to guess?`,
          },
        }),],
        on: { SPEAK_COMPLETE: "UserInput" },},

        UserInput: {
          entry: ({ context }) =>
              context.ssRef.send({
                type: "LISTEN",
                value: { nlu: true },
              }),
              on: 
              {RECOGNISED: [//this is a bit clumsy, but the guard priority can't be the same here as in the higher level
              //transitions since those just dealt with intents, and here we deal with a particular priority
              //of different kinds of intents and entities
              {guard: and(["lowIntentConfidence", "solutionLength", "knownTop"]), target: "#DM.Confirmation",
                actions: [{type: "updateConfirmationTopic"},{type: "updateConfirmationASR"},]},
              {guard: and(["solutionLength", "knownTop"]), target: "#DM.KnownEvidence"},
              {guard: and(["lowIntentConfidence", "solutionLength", "suspectsTop"]), target: "#DM.Confirmation",
                actions: [{type: "updateConfirmationTopic"},{type: "updateConfirmationASR"},]},
              {guard: and(["solutionLength", "suspectsTop"]), target: "#DM.Suspects"},
              {guard: and(["lowIntentConfidence", "solutionLength", "instructionsTop"]), target: "#DM.Confirmation",
                actions: [{type: "updateConfirmationTopic"},{type: "updateConfirmationASR"},]},
              {guard: and(["solutionLength", "instructionsTop"]), target: "#DM.MidgameInstructions"},
                {guard: "solutionLength", target: "RedoIntermediate",
              actions: [
                ({ context, }) => context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `Guesses must be two items. Let's try again.`,
            },
          }),]},
              {guard: not("checkValidity"), target: "RedoIntermediate", actions:
              ({ context, event}) =>         
              context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `${event.nluValue.entities[0].category} and ${event.nluValue.entities[1].category} is not possible! Guesses must be one means of murder and one clue from the same suspect. Let's try again`,
                },
              }),},
              {guard: not('solutionConfidence'), target: "#DM.Confirmation", actions: ["storeGuess", "updateConfirmationASR"]},
              {target: "ResolveGuess", actions: [
                "storeGuess", 
              ]}],},},

          ResolveGuess: {
            always: [
              {
                guard: and(["checkEnt0", "checkEnt1"]),
              target: "#DM.Final",
            actions:
              ({ context }) =>         
              context.ssRef.send({
                type: "SPEAK",
                value: {
                  utterance: `${context.guess[0]} and ${context.guess[1]}? That's correct! Nice work detective!
                  Your final score is ${6-context.queryCounter-context.solveCounter}`,
                },
              }),
            },
        
        {target: "GameOverCheck", 
        actions: [
          ({ context, }) =>         
          context.ssRef.send({
            type: "SPEAK",
            value: {
              utterance: `${context.guess[0]} and ${context.guess[1]}? That's incorrect!`,
            },
          }),
          {type: "solveCounterIncrement"}, "guessReset"
        ]
      }
    ]
  },

          RedoIntermediate: {
            on: { SPEAK_COMPLETE: "PartnerQuery" },},
        GameOverCheck: {
          on: { SPEAK_COMPLETE: [
            {guard: ({ context }) => context.solveCounter >1,
            target: "#DM.Final",
            actions: ({ context, }) =>         
            context.ssRef.send({
              type: "SPEAK",
              value: {
                utterance: `Dangit, it seems the case has gone cold! Hopefully we get the next one.
                Your final score is 0.`,
              },
            }),
          },
          {target: "#DM.MainParent"}]
        },
      },
    },},},},
    Final: {
    },
  },
});


const dmActor = createActor(dmMachine, {
  inspect: inspector.inspect,
}).start();


export function setupButton(element) {
  element.addEventListener("click", () => {
    dmActor.send({ type: "CLICK" });
  });
  dmActor.getSnapshot().context.ssRef.subscribe((snapshot) => {
    element.innerHTML = `${snapshot.value.AsrTtsManager.Ready}`;
  });
}
