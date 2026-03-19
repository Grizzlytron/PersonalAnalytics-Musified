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
    'https://www.dropbox.com/scl/fo/3icsygtmvnqnljjkyuu4j/AG-GaLrWqT_o2tU7n9qnFvM?rlkey=9z2voh0de4xh2a2d47n1ghasy&st=7e1zvoav&dl=0', // https://datadonation.uzh.ch/ddm/studies/grizzlyAnalytics/briefing/
  contactName: 'Lucas Bär',
  contactEmail: 'lucastimothyleo.baer@uzh.ch',
  subjectIdLength: 6,
  dataExportEnabled: true,
  dataExportFormat: DataExportFormat.ExportAsZippedSqlite, // default should be ExportAsZippedSqlite,
  dataExportDDLProjectName: 'PA_Test3',
  dataExportEncrypted: false,
  displayDaysParticipated: true,
  showActiveTimesInOnboarding: true,
  trackers: {
    windowActivityTracker: {
      enabled: true,
      intervalInMs: 1000,
      trackUrls: false,
      trackWindowTitles: true
    },
    userInputTracker: {
      enabled: true,
      intervalInMs: 60000
    },
    experienceSamplingTracker: {
      enabled: true,
      enabledWorkHours: false,
      scale: 7,
      questions: [
        // 'Compared to your normal level of productivity, how productive do you consider the previous session?',
        // 'How well did you spend your time in the previous session?',
        'How focused did you feel in the last session?'
      ],
      responseOptions: [
        // ['not at all productive', 'moderately productive', 'very productive'],
        // ['not well', 'moderately well', 'very well'],
        ['not focused', 'moderately focused', 'very focused']
      ],
      intervalInMs: 1000 * 60 * 5, // default interval (must be listed in userDefinedInterval_h if set)
      samplingRandomization: 0.2, // 20% randomization, so the interval will be between 4 and 6 minutes
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
