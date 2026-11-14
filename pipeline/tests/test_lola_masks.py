# Written with assistance from Claude Code (Anthropic).
"""Tests for pipeline/lola_masks.py (CLAUDE.md, step 3). Standard library + numpy only.

    python3 -m unittest discover -s pipeline/tests -v
"""
import math, os, sys, unittest
import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import lola_masks as lm

N = 3812
HAVE_DEM = os.path.exists(lm.DEM_PATH)
SHACKLETON = (-89.67, 129.78)
OBSERVER = (-89.682, -163.37)      # test 4: a point near the pole
IM2 = (-84.7906, 29.1957)          # ... from which the IM-2 site lies at azimuth 191.85°, 167.4 km


class FlatMoon(unittest.TestCase):
    def test_1_flat_dem_gives_the_2m_dip(self):
        mask, h0 = lm.compute_mask(np.zeros((N, N), np.float32), -85.0, 30.0)
        dip = -math.degrees(math.acos(lm.R / (lm.R + lm.H_OBS)))
        print(f"\n  flat DEM: mask {mask.min():.4f} .. {mask.max():.4f} deg, exact dip {dip:.4f}")
        self.assertEqual(h0, 0.0)
        self.assertAlmostEqual(dip, -0.0869, places=4)
        self.assertTrue(np.all(np.abs(mask - dip) < 0.0005))


class Projection(unittest.TestCase):
    def test_2_round_trip_within_1_m(self):
        worst = 0.0
        for lat in (-75.0, -80.13, -84.7906, -88.74, -89.9, -90.0):
            for lon in (-179.0, -66.7, 0.0, 29.1957, 90.0, 124.5, 180.0):
                lat2, lon2 = lm.pixel_to_latlon(*lm.latlon_to_pixel(lat, lon, N), N)
                worst = max(worst, lm.azimuth_distance(lat, lon, lat2, lon2)[1])
        print(f"\n  round trip: worst error {worst * 1000:.4f} mm")
        self.assertLess(worst, 1.0)

    def test_2b_orientation_lon0_up_lon90E_right(self):
        c, r = lm.latlon_to_pixel(-80, 0, N)
        self.assertAlmostEqual(c, N / 2 - 0.5); self.assertLess(r, N / 2 - 0.5)
        c, r = lm.latlon_to_pixel(-80, 90, N)
        self.assertGreater(c, N / 2 - 0.5); self.assertAlmostEqual(r, N / 2 - 0.5)


class Direction(unittest.TestCase):
    def test_4_bump_at_im2_shows_at_191_85(self):
        az, dist = lm.azimuth_distance(*OBSERVER, *IM2)
        print(f"\n  IM-2 from {OBSERVER}: azimuth {az:.2f} deg, distance {dist / 1000:.1f} km")
        self.assertAlmostEqual(az, 191.85, delta=0.05)
        self.assertAlmostEqual(dist / 1000, 167.4, delta=0.1)

        dem = np.zeros((N, N), np.float32)
        c, r = (int(round(v)) for v in lm.latlon_to_pixel(*IM2, N))
        # CLAUDE.md asks for a 1 km bump, but on a flat Moon the surface 167 km away is ~8 km below the
        # observer's horizontal plane, so a 1 km bump stays hidden. Check that, then use a 20 km one.
        dem[r - 2:r + 3, c - 2:c + 3] = 1000.0
        low, _ = lm.compute_mask(dem, *OBSERVER)
        hidden = float(np.ptp(low)) < 0.001
        dem[r - 2:r + 3, c - 2:c + 3] = 20000.0
        mask, _ = lm.compute_mask(dem, *OBSERVER)
        peak = mask.argmax() * 360.0 / lm.N_AZ
        print(f"  1 km bump hidden below the horizon: {hidden}; 20 km bump: peak {mask.max():.2f} deg at azimuth {peak:.2f}")
        self.assertTrue(hidden)
        self.assertGreater(mask.max(), 1.0)
        self.assertAlmostEqual(peak, 191.85, delta=0.5)
        self.assertGreater(abs(peak - 136.6), 10)       # where it would be with mirrored longitude


@unittest.skipUnless(HAVE_DEM, "DEM not downloaded: python3 pipeline/lola_masks.py --download")
class RealDem(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.dem = lm.load_dem()

    def test_3_shackleton_is_a_deep_crater(self):
        self.assertEqual(self.dem.shape, (N, N))
        centre = lm.ground_height(self.dem, *SHACKLETON)
        ring = np.mean([lm.ground_height(self.dem, *lm.destination(*SHACKLETON, az, 10000.0)) for az in range(0, 360, 5)])
        mask, _ = lm.compute_mask(self.dem, *SHACKLETON)
        print(f"\n  Shackleton: centre {centre:.0f} m, 10 km ring mean {ring:.0f} m, depth {ring - centre:.0f} m; "
              f"mask {mask.min():.1f} .. {mask.max():.1f} deg (median {np.median(mask):.1f})")
        self.assertGreaterEqual(ring - centre, 3500)
        self.assertGreaterEqual(mask.min(), 15)
        self.assertLessEqual(mask.max(), 25)

    def test_5_hillshade_is_written(self):
        path = lm.hillshade(self.dem)
        with open(path, "rb") as f:
            self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")
        print(f"\n  hillshade: {os.path.relpath(path)} ({os.path.getsize(path) // 1024} KB) — compare by eye with Quickmap")


if __name__ == "__main__":
    unittest.main(verbosity=2)
