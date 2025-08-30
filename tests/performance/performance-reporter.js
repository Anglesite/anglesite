// ABOUTME: Custom Jest reporter for performance test results and regression detection
// ABOUTME: Generates detailed performance reports with trend analysis and baseline comparisons

const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Custom Jest reporter for performance benchmarks
 */
class PerformanceReporter {
  constructor(globalConfig, options = {}) {
    this.globalConfig = globalConfig;
    this.options = {
      outputPath: options.outputPath || './performance-results/benchmark-results.json',
      includeSystemInfo: options.includeSystemInfo !== false,
      trackTrends: options.trackTrends !== false,
      thresholds: {
        regressionPercent: 15, // Flag regressions > 15%
        significantChangePercent: 5, // Flag changes > 5%
        ...options.thresholds
      },
      ...options
    };
    
    this.testResults = [];
    this.benchmarkResults = [];
    this.summary = {
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      regressions: [],
      improvements: [],
      warnings: []
    };
  }

  onRunStart(aggregatedResult, options) {
    console.log('\n🚀 Starting performance benchmark suite...\n');
    this.startTime = Date.now();
  }

  onTestResult(test, testResult, aggregatedResult) {
    this.summary.totalTests++;
    
    if (testResult.numFailingTests === 0) {
      this.summary.passedTests++;
    } else {
      this.summary.failedTests++;
    }
    
    // Collect benchmark results from global scope
    if (global.benchmarkResults && global.benchmarkResults.length > 0) {
      this.benchmarkResults.push(...global.benchmarkResults);
      global.benchmarkResults = []; // Clear for next test
    }
    
    this.testResults.push({
      testFilePath: test.path,
      testResult: {
        numFailingTests: testResult.numFailingTests,
        numPassingTests: testResult.numPassingTests,
        numTodoTests: testResult.numTodoTests,
        testResults: testResult.testResults.map(result => ({
          title: result.title,
          fullName: result.fullName,
          status: result.status,
          duration: result.duration
        }))
      }
    });
  }

  onRunComplete(contexts, results) {
    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;
    
    console.log('\n📊 Performance benchmark results:\n');
    
    // Process benchmark results
    this.processBenchmarkResults();
    
    // Generate and save report
    const report = this.generateReport(totalDuration);
    this.saveReport(report);
    
    // Print summary
    this.printSummary(report);
    
    // Check for regressions and exit with appropriate code
    if (this.summary.regressions.length > 0) {
      console.error('\n❌ Performance regressions detected!');
      process.exitCode = 1;
    } else if (this.summary.improvements.length > 0) {
      console.log('\n🎉 Performance improvements detected!');
    }
  }

  processBenchmarkResults() {
    for (const benchmark of this.benchmarkResults) {
      // Load baseline if available
      const baselinePath = path.join(__dirname, 'baselines', `${benchmark.name}.baseline.json`);
      let baseline = null;
      
      if (fs.existsSync(baselinePath)) {
        try {
          baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
        } catch (error) {
          console.warn(`⚠️ Could not load baseline for ${benchmark.name}: ${error.message}`);
        }
      }
      
      if (baseline) {
        const comparison = this.compareWithBaseline(benchmark, baseline);
        benchmark.comparison = comparison;
        
        if (comparison.isRegression) {
          this.summary.regressions.push({
            name: benchmark.name,
            percentChange: comparison.percentChange,
            currentTime: benchmark.timing.avg,
            baselineTime: baseline.timing.avg
          });
        } else if (comparison.isImprovement) {
          this.summary.improvements.push({
            name: benchmark.name,
            percentChange: Math.abs(comparison.percentChange),
            currentTime: benchmark.timing.avg,
            baselineTime: baseline.timing.avg
          });
        }
      }
      
      // Check for performance warnings
      this.checkPerformanceWarnings(benchmark);
    }
  }

  compareWithBaseline(current, baseline) {
    const currentTime = current.timing.avg;
    const baselineTime = baseline.timing.avg;
    const percentChange = ((currentTime - baselineTime) / baselineTime) * 100;
    
    const comparison = {
      current: currentTime,
      baseline: baselineTime,
      change: currentTime - baselineTime,
      percentChange: percentChange,
      isRegression: false,
      isImprovement: false,
      isSignificant: false
    };
    
    const absPercentChange = Math.abs(percentChange);
    
    if (absPercentChange >= this.options.thresholds.significantChangePercent) {
      comparison.isSignificant = true;
      
      if (percentChange >= this.options.thresholds.regressionPercent) {
        comparison.isRegression = true;
      } else if (percentChange <= -this.options.thresholds.regressionPercent) {
        comparison.isImprovement = true;
      }
    }
    
    return comparison;
  }

  checkPerformanceWarnings(benchmark) {
    const warnings = [];
    
    // Check timing consistency
    const cv = this.calculateCoefficientOfVariation(benchmark.timing.times);
    if (cv > 0.2) { // 20% coefficient of variation
      warnings.push(`High timing variability (CV: ${(cv * 100).toFixed(1)}%)`);
    }
    
    // Check memory usage
    const memoryMB = benchmark.memory.heapUsed / (1024 * 1024);
    if (memoryMB > 100) { // 100MB threshold
      warnings.push(`High memory usage (${memoryMB.toFixed(1)}MB)`);
    }
    
    // Check P95/P99 latencies
    if (benchmark.timing.p95 > benchmark.timing.avg * 3) {
      warnings.push(`High P95 latency (${benchmark.timing.p95.toFixed(2)}ms vs avg ${benchmark.timing.avg.toFixed(2)}ms)`);
    }
    
    if (warnings.length > 0) {
      this.summary.warnings.push({
        name: benchmark.name,
        warnings: warnings
      });
    }
  }

  calculateCoefficientOfVariation(values) {
    const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    return stdDev / mean;
  }

  generateReport(totalDuration) {
    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        totalDuration: totalDuration,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        cpuCount: os.cpus().length,
        totalMemory: os.totalmem(),
        freeMemory: os.freemem(),
        jestVersion: require('jest/package.json').version
      },
      summary: this.summary,
      benchmarks: this.benchmarkResults.map(benchmark => ({
        name: benchmark.name,
        timestamp: benchmark.timestamp,
        iterations: benchmark.iterations,
        timing: benchmark.timing,
        memory: {
          heapUsed: benchmark.memory.heapUsed,
          heapUsedMB: (benchmark.memory.heapUsed / 1024 / 1024).toFixed(2),
          heapTotal: benchmark.memory.heapTotal,
          external: benchmark.memory.external,
          rss: benchmark.memory.rss
        },
        systemInfo: benchmark.systemInfo,
        comparison: benchmark.comparison || null,
        performanceMetrics: {
          throughput: benchmark.iterations / (benchmark.timing.avg / 1000), // ops/sec
          efficiency: benchmark.memory.heapUsed / benchmark.timing.avg, // memory/time
          consistency: this.calculateCoefficientOfVariation(benchmark.timing.times)
        }
      })),
      tests: this.testResults
    };
    
    // Add trend analysis if tracking trends
    if (this.options.trackTrends) {
      report.trends = this.analyzeTrends();
    }
    
    return report;
  }

  analyzeTrends() {
    // This would analyze historical data to identify trends
    // For now, provide a basic structure
    return {
      overallTrend: 'stable', // 'improving', 'degrading', 'stable'
      significantChanges: this.summary.regressions.length + this.summary.improvements.length,
      regressionCount: this.summary.regressions.length,
      improvementCount: this.summary.improvements.length
    };
  }

  saveReport(report) {
    const outputDir = path.dirname(this.options.outputPath);
    
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    try {
      fs.writeFileSync(this.options.outputPath, JSON.stringify(report, null, 2));
      console.log(`📁 Performance report saved to: ${this.options.outputPath}`);
    } catch (error) {
      console.error(`❌ Failed to save performance report: ${error.message}`);
    }
    
    // Also save a human-readable summary
    const summaryPath = this.options.outputPath.replace('.json', '-summary.txt');
    const summaryText = this.generateTextSummary(report);
    
    try {
      fs.writeFileSync(summaryPath, summaryText);
      console.log(`📄 Performance summary saved to: ${summaryPath}`);
    } catch (error) {
      console.error(`❌ Failed to save performance summary: ${error.message}`);
    }
  }

  generateTextSummary(report) {
    let summary = '';
    
    summary += '='.repeat(60) + '\n';
    summary += 'PERFORMANCE BENCHMARK REPORT\n';
    summary += '='.repeat(60) + '\n\n';
    
    summary += `Generated: ${report.metadata.timestamp}\n`;
    summary += `Platform: ${report.metadata.platform} ${report.metadata.arch}\n`;
    summary += `Node.js: ${report.metadata.nodeVersion}\n`;
    summary += `CPUs: ${report.metadata.cpuCount}\n`;
    summary += `Memory: ${(report.metadata.totalMemory / 1024 / 1024 / 1024).toFixed(2)}GB\n\n`;
    
    summary += 'SUMMARY\n';
    summary += '-'.repeat(30) + '\n';
    summary += `Total Tests: ${report.summary.totalTests}\n`;
    summary += `Passed: ${report.summary.passedTests}\n`;
    summary += `Failed: ${report.summary.failedTests}\n`;
    summary += `Benchmarks: ${report.benchmarks.length}\n`;
    summary += `Regressions: ${report.summary.regressions.length}\n`;
    summary += `Improvements: ${report.summary.improvements.length}\n`;
    summary += `Warnings: ${report.summary.warnings.length}\n\n`;
    
    if (report.benchmarks.length > 0) {
      summary += 'BENCHMARK RESULTS\n';
      summary += '-'.repeat(30) + '\n';
      
      for (const benchmark of report.benchmarks) {
        summary += `\n${benchmark.name}:\n`;
        summary += `  Average Time: ${benchmark.timing.avg.toFixed(2)}ms\n`;
        summary += `  Min/Max: ${benchmark.timing.min.toFixed(2)}ms / ${benchmark.timing.max.toFixed(2)}ms\n`;
        summary += `  P95/P99: ${benchmark.timing.p95.toFixed(2)}ms / ${benchmark.timing.p99.toFixed(2)}ms\n`;
        summary += `  Memory: ${benchmark.memory.heapUsedMB}MB\n`;
        summary += `  Throughput: ${benchmark.performanceMetrics.throughput.toFixed(2)} ops/sec\n`;
        summary += `  Consistency: ${(benchmark.performanceMetrics.consistency * 100).toFixed(1)}% CV\n`;
        
        if (benchmark.comparison) {
          const comp = benchmark.comparison;
          const changeSymbol = comp.percentChange > 0 ? '📈' : '📉';
          summary += `  vs Baseline: ${changeSymbol} ${comp.percentChange > 0 ? '+' : ''}${comp.percentChange.toFixed(1)}%\n`;
        }
      }
    }
    
    if (report.summary.regressions.length > 0) {
      summary += '\n\nREGRESSIONS\n';
      summary += '-'.repeat(30) + '\n';
      
      for (const regression of report.summary.regressions) {
        summary += `❌ ${regression.name}: +${regression.percentChange.toFixed(1)}% slower\n`;
        summary += `   Current: ${regression.currentTime.toFixed(2)}ms\n`;
        summary += `   Baseline: ${regression.baselineTime.toFixed(2)}ms\n\n`;
      }
    }
    
    if (report.summary.improvements.length > 0) {
      summary += '\n\nIMPROVEMENTS\n';
      summary += '-'.repeat(30) + '\n';
      
      for (const improvement of report.summary.improvements) {
        summary += `🎉 ${improvement.name}: ${improvement.percentChange.toFixed(1)}% faster\n`;
        summary += `   Current: ${improvement.currentTime.toFixed(2)}ms\n`;
        summary += `   Baseline: ${improvement.baselineTime.toFixed(2)}ms\n\n`;
      }
    }
    
    if (report.summary.warnings.length > 0) {
      summary += '\n\nWARNINGS\n';
      summary += '-'.repeat(30) + '\n';
      
      for (const warning of report.summary.warnings) {
        summary += `⚠️ ${warning.name}:\n`;
        for (const msg of warning.warnings) {
          summary += `   - ${msg}\n`;
        }
        summary += '\n';
      }
    }
    
    return summary;
  }

  printSummary(report) {
    console.log('📊 Performance Summary:');
    console.log(`   Tests: ${report.summary.passedTests}/${report.summary.totalTests} passed`);
    console.log(`   Benchmarks: ${report.benchmarks.length}`);
    
    if (report.summary.regressions.length > 0) {
      console.log(`   🔴 Regressions: ${report.summary.regressions.length}`);
      report.summary.regressions.forEach(regression => {
        console.log(`      • ${regression.name}: +${regression.percentChange.toFixed(1)}% slower`);
      });
    }
    
    if (report.summary.improvements.length > 0) {
      console.log(`   🟢 Improvements: ${report.summary.improvements.length}`);
      report.summary.improvements.forEach(improvement => {
        console.log(`      • ${improvement.name}: ${improvement.percentChange.toFixed(1)}% faster`);
      });
    }
    
    if (report.summary.warnings.length > 0) {
      console.log(`   🟡 Warnings: ${report.summary.warnings.length}`);
    }
    
    // Print top performers
    const sortedBenchmarks = report.benchmarks.sort((a, b) => a.timing.avg - b.timing.avg);
    if (sortedBenchmarks.length > 0) {
      console.log('\n⚡ Fastest Benchmarks:');
      sortedBenchmarks.slice(0, 3).forEach((benchmark, i) => {
        console.log(`   ${i + 1}. ${benchmark.name}: ${benchmark.timing.avg.toFixed(2)}ms`);
      });
    }
    
    if (sortedBenchmarks.length > 3) {
      console.log('\n🐌 Slowest Benchmarks:');
      sortedBenchmarks.slice(-3).reverse().forEach((benchmark, i) => {
        console.log(`   ${i + 1}. ${benchmark.name}: ${benchmark.timing.avg.toFixed(2)}ms`);
      });
    }
  }
}

module.exports = PerformanceReporter;