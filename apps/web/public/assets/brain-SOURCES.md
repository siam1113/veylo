# Anatomical brain asset

`anatomical-brain.glb` is derived from the left and right fsaverage5 pial
surfaces distributed with Nilearn, with curvature-based natural rose coloring.
It contains the cerebral cortex, not the cerebellum or brainstem. This is a
visual design asset, not a diagnostic or patient-specific model.

Source: https://github.com/nilearn/nilearn/tree/main/nilearn/datasets/data/fsaverage5
Documentation: https://nilearn.github.io/stable/modules/generated/nilearn.datasets.fetch_surf_fsaverage.html
Redistribution notice: [brain-LICENSE.txt](brain-LICENSE.txt)

Source Git blob SHAs:

- pial_left.gii.gz: fab64d04cf226b6ccc68d6446257c513aa6c1ff6
- pial_right.gii.gz: 279806e31391976b04374c851bf7df3bd39962f8
- curv_left.gii.gz: 97931772c67b0dcca1a76119a61cb9e4270dd99e
- curv_right.gii.gz: 13549d28c064ee877768667f895c4be9f819ab6e

Conversion: `apps/web/scripts/build-brain-model.py`. Changes: coordinate
orientation, centering and uniform scaling, computed smooth vertex normals,
curvature-driven vertex colors, and conversion from GIFTI to binary glTF.
The model is bundled locally and does not require a third-party request at runtime.
