import { StudyConfiguration } from './StudyConfiguration';
import { DataExportFormat } from './DataExportFormat.enum';

const studyConfig: StudyConfiguration = {
  name: 'Muselytics',
  shortDescription:
    "Muselytics is a version of PersonalAnalytics, which integrates a Muse S Athena (2025) tracker into PersonalAnalytics and extends the self-monitoring software developed by the Human Aspects of Software Engineering Lab of the University of Zurich to non-intrusively collect computer interaction data and store it locally on your computer. Every now and then, a self-reflection question asks you about time well spent and perceived productivity. In the future, it will add a retrospection that will visualize and correlate the automatically collected and manually reported data to help you learn more about how you spend your time and your productivity. This software is open source, can be adapted and re-used for your own scientific studies.",
  infoUrl: 'https://github.com/Grizzlytron/Muselytics',
  privacyPolicyUrl:
    'https://github.com/Grizzlytron/Muselytics/blob/dev/documentation/PRIVACY.md',
  uploadUrl:
    'https://www.dropbox.com/scl/fo/3icsygtmvnqnljjkyuu4j/AG-GaLrWqT_o2tU7n9qnFvM?rlkey=9z2voh0de4xh2a2d47n1ghasy&st=6e8mmf3f&dl=0', // https://datadonation.uzh.ch/ddm/studies/grizzlyAnalytics/briefing/
  contactName: 'Lucas Bär',
  contactEmail: 'lucastimothyleo.baer@uzh.ch',
  subjectIdLength: 6,
  dataExportEnabled: true,
  dataExportFormat: DataExportFormat.ExportAsZippedSqlite,
  dataExportEncrypted: false,
  nBackInterface: {
    enabled: true,
    title: 'Space Crusaders',
    description:
      "Hello Captain! The Situation is pressing and we need your help. We are currently flying on an intergalactic spaceship while galactic monsters are chasing us across the galaxy. Your mission is to outrun them across 5 levels by making precise gate decisions under pressure. You need to decide when to boost our engine through a gate by pressing J only when the level rule says the gate is open; if it is not open, do not press anything. Watch your Speed Bar: correct guesses give a speed boost, while incorrect guesses cause a speed drop and increase the chance of being caught and eaten by the monsters. After each level, we enter a worm hole that warps us to one of the remaining difficulty levels in random order. Before this, Mission Control will ask you two self-reflection questions. Good luck, Captain!",
    scale: 7,
    tasks: [
      {
        n: 0,
        totalTrials: 20
      },
      {
        n: 1
      },
      {
        n: 2
      },
      {
        n: 2,
        withDistractions: true
      },
      {
        n: 3
      }
    ],
    reflectionQuestions: [
      {
        id: 'demanding',
        text: 'How mentally demanding was this block for you?',
        minLabel: 'Not demanding',
        midLabel: 'Moderate',
        maxLabel: 'Very demanding'
      },
      {
        id: 'focused',
        text: 'During the last block, how focused were you on the task?',
        minLabel: 'Not focused',
        midLabel: 'Moderately focused',
        maxLabel: 'Very focused'
      }
    ],
    distractionDotCount: 18,
    randomizeTasksAfterFirstLevel: true
  },
  displayDaysParticipated: true,
  showActiveTimesInOnboarding: true,
  enableRetrospection: true,
  trackers: {
    windowActivityTracker: {
      enabled: true,
      intervalInMs: 1000,
      trackUrls: false,
      trackWindowTitles: true
    },
    userInputTracker: {
      enabled: true,
      intervalInMs: 60000,
      collectKeyDetails: true
    },
    experienceSamplingTracker: {
      enabled: true,
      enabledWorkHours: false,
      questions: [
        {
          question:
            'Compared to your normal level of focus, how focused did you feel in the last interval?',
          answerType: 'LikertScale',
          scale: 7,
          responseOptions: ['not at all focused', 'moderately focused', 'very focused']
        },
        {
          question: 'Compared to your normal level of mental effort, how mentally demanding did this last interval feel?',
          answerType: 'LikertScale',
          scale: 7,
          responseOptions: ['not at all demanding', 'moderately demanding', 'very demanding']
        },
        // {
        //   question: 'Compared to your normal level of mental effort, how much effort did you put in the last session?'
        //   answerType: 'TextResponse',
        //   responseOptions: 'singleLine',
        //   maxLength: 100
        // },
        // {
        //   question: 'Which distractions did you experience in the last session?',
        //   answerType: 'MultiChoice',
        //   responseOptions: ['Notifications', 'Meetings', 'Context switching', 'Personal interruptions', 'None']
        // }
      ],
      intervalInMs: 1000 * 60 * 15, // default interval (must be listed in userDefinedInterval_h if set)
      samplingRandomization: 0.2, // 20% randomization, so the interval will be between 12 and 18 minutes
      allowUserToDisable: true,
      allowUserToChangeInterval: true,
      userDefinedInterval_h: [0.0833, 0.25, 0.5, 1, 2, 4]
    },
    museTracker: {
      enabled: true,
      intervalInMs: 1000,
      autoConnect: false
    }
  }
};

export default studyConfig;
