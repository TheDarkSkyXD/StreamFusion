# Player overlay decision

Candidate B is the base. WatchScreen already owns captions, media jobs, and More, so their buttons move into its existing player stage. PlayerControls keeps its existing Quality and Fullscreen controls. The external five-button row is deleted.

The selected secondary sheet moves to WatchRoute because its existing visibility timer needs the same canonical state. The sheet remains available in fullscreen. PiP entry and a changed playback target clear it. No generic toolbar API, action registry, or player remount is needed.

Experience First changed the placement to controls directly over the video. Laziness Protocol kept PlayerControls unchanged and removed the duplicate row. Model the Domain keeps one selected sheet discriminant instead of a mirrored open boolean. Prove It Works requires native portrait and fullscreen taps and inspected screenshots before completion.

Native layout and taps remain a verification gate. The existing Android Development installation and its data are preserved.
