# Data Storage & Confidentiality

## Goal & Overview
PersonalAnalytics (Musified) is a Windows and macOS application designed to be installed on knowledge workers' computers to non-intrusively collect certain computer interaction data as well as biometric data from a Muse S headband. Computer interaction data include user input and application usage data, as well as self-report data using an experience sampling component. The idea is that researchers can deploy PersonalAnalytics with  study participants to allow them to collect data during baseline and intervention phases and help them to answer their research questions. When creating a release of PersonalAnalytics, researchers can configure which data is collected. All data is stored **only locally** and **never automatically shared with the researchers without a user's  explicit consent**. 

## Overview over Collected Data
Currently, there are 5 data trackers collecting data and storing it locally on user's computers:
- **User Input Tracker**: User input data stems from mouse (number of clicks, pixels moved and pixels scrolled) and keyboard (number of keystrokes) and is aggregated per interval (e.g. once a minute). Note that the actual keys pressed are _not_ stored (no keylogging!)
- **Windows Activity Tracker**: The application usage data includes an entry for each time a user switches from one app, website or file to another, storing the time of switch, app name and window title. The application usage is then automatically categorized using [research-based heuristics]([url](https://www.zora.uzh.ch/id/eprint/136503/1/productiveWorkday_TSE17.pdf)) ([source]([url](https://github.com/HASEL-UZH/PA.WindowsActivityTracker/tree/main/typescript/src/mappings))). 
- **Experience Sampling Tracker**: Researchers can also define one or multiple questions that are shown to users at random intervals and ask to provide a rating to a question, such as on their perceived productivity, well-being, or stress levels. Only the question, rating (e.g. 5/7) and timestamp are stored.
- **Days Participated Tracker**: Tracks the amount of days participated in the study.
- **Muse Tracker**: Biometric data in the form of EEG, fNIRS and PPG metrics are currently saved. EEG refers to electroencephalography and relates to the brainwaves emitted from the brain, which are recorded at 256Hz. fNIRS and PPG metrics are recorded with a 64Hz sampling rate. 

## Accessing, Modifying or Deleting the Data
As mentioned above, all data is stored locally only on participant's machines. Users can access it, by clicking "Open Collected Data" in the taskbar icon (on Windows) or menubar (on macOS) and opening the file `database.sqlite` in a sqlite-compatible database viewer (such as [DB Browser for SQLite](https://sqlitebrowser.org/)).

Should a user want to modify and/or delete their data, they can do so directly in the sqlite-file. No other copies of the data exists, unless the user made them. 

## Sharing Collected Data
In case users are running PersonalAnalytics during a scientific study, the researchers might ask the users (or in this context, participants) to share their data with the reseachers. To that purpose, we recommend using the built-in data obfuscation and export feature, which allows users to understand what the data will be used for as part of the research project, review the collected data and decide which data they want to share and/or obfuscate. Afterwards, an encrypted and password-protected (if enabled in config) file is created which can be shared with the researchers per their instructions. The data export tool can be accessed by clicking "Export Data" in the taskbar icon (on Windows) or menubar (on macOS).

## Note on Using PersonalAnalytics (Musified)
Note that the creators of PersonalAnalytics (Musified) can in no way be held liable against use, misuse or problems that arise from using the app. The base app was developed as a public, open-source application that can be freely used and extended (with [correct attribution](https://github.com/HASEL-UZH/PersonalAnalytics/blob/main/documentation/RESEARCH.md)). This extension of PersonalAnalytics may not be freely used or distributed, as the software is tied to InteraXon's Muse SDK. The researchers are responsible for informing users (or participants) of the usage of PersonalAnalytics (Musified), collected data and usage of any data that is shared with researchers, as well as data privacy and data security. 

## Questions and Support
You may contact André Meyer (ameyer@ifi.uzh.ch) in case of questions on PersonalAnalytics. For questions regarding PersonalAnalytics (Musified), you may contact Lucas Baer (lucastimothyleo.baer@uzh.ch).
 If you encounter technical issues, create an [issue]([url](https://github.com/HASEL-UZH/PersonalAnalytics/issues)https://github.com/HASEL-UZH/PersonalAnalytics/issues), so that the community may offer help.
